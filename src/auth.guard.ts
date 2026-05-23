/**
 * @file auth.guard.ts
 * @description JWT Authentication Guard for NestJS route protection.
 *
 * This guard is imported directly by TransferController via:
 *   import { AuthGuard } from './auth.guard';
 *
 * It validates the Bearer token from the Authorization header, verifies it
 * against the session store in Redis (to honour server-side logout/revocation),
 * and attaches the decoded user payload to `request.user` — which is then
 * picked up by the `@CurrentUser()` decorator in the controller.
 *
 * Integration points:
 *   - AuthenticationService.validateSession()  — checks Redis session cache
 *   - PrismaService.session.findUnique()        — fallback DB session check
 *   - JwtService.verify()                       — cryptographic token check
 *   - TransferController (all guarded routes)
 *   - UpiPaymentController (all guarded routes)
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import * as crypto from 'crypto';

// ============================================================================
// TYPES
// ============================================================================

/** Shape attached to `request.user` after successful guard validation. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  upiHandle: string;
  sessionId: string;
  deviceId: string;
}

// ============================================================================
// JWT AUTH GUARD
// ============================================================================

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException(
        'Authorization header missing or malformed. Expected: Bearer <token>',
      );
    }

    // -------------------------------------------------------------------------
    // STEP 1 — Cryptographic JWT verification
    // Verifies signature, expiry, issuer, and audience in one call.
    // -------------------------------------------------------------------------
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.config.get<string>('JWT_SECRET'),
        issuer: this.config.get<string>('JWT_ISSUER', 'banking-platform'),
        audience: this.config.get<string>(
          'JWT_AUDIENCE',
          'banking-platform-api',
        ),
      });
    } catch (err) {
      this.logger.warn(
        `[AUTH-GUARD] JWT verification failed: ${err.message}`,
      );
      throw new UnauthorizedException(
        'Invalid or expired token. Please log in again.',
      );
    }

    // -------------------------------------------------------------------------
    // STEP 2 — Session revocation check via Redis
    //
    // Even a cryptographically valid JWT is rejected if the session has been
    // revoked (logout, password change, suspicious activity flag).
    //
    // The session cache key mirrors AuthenticationService's pattern:
    //   session:<userId>:<sessionId>
    // -------------------------------------------------------------------------
    const sessionCacheKey = `session:${payload.sessionId}`;
    const cachedSession = await this.redis
      .get(sessionCacheKey)
      .catch(() => null); // Never hard-fail on Redis outage

    if (cachedSession === null) {
      // Not in Redis — check PostgreSQL as authoritative fallback.
      const tokenHash = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      const dbSession = await this.prisma.session
        .findUnique({
          where: { tokenHash },
          select: {
            id: true,
            userId: true,
            expiresAt: true,
            revokedAt: true,
          },
        })
        .catch(() => null);

      if (!dbSession) {
        throw new UnauthorizedException(
          'Session not found. Please log in again.',
        );
      }

      if (dbSession.revokedAt) {
        throw new UnauthorizedException(
          'Session has been revoked. Please log in again.',
        );
      }

      if (dbSession.expiresAt < new Date()) {
        throw new UnauthorizedException('Session has expired. Please log in.');
      }

      // Re-warm Redis cache so subsequent requests are fast (TTL = remaining
      // session time, capped at 1 hour to avoid stale cache after revocation).
      const remainingSec = Math.min(
        Math.floor((dbSession.expiresAt.getTime() - Date.now()) / 1000),
        3600,
      );
      await this.redis
        .setex(sessionCacheKey, remainingSec, 'valid')
        .catch(() => {
          /* non-critical */
        });
    } else if (cachedSession === 'revoked') {
      throw new UnauthorizedException(
        'Session has been revoked. Please log in again.',
      );
    }

    // -------------------------------------------------------------------------
    // STEP 3 — Attach authenticated user to request
    // This is what @CurrentUser() reads in the controller.
    // -------------------------------------------------------------------------
    const authenticatedUser: AuthenticatedUser = {
      id: payload.sub,
      email: payload.email,
      upiHandle: payload.upiHandle,
      sessionId: payload.sessionId,
      deviceId: payload.deviceId,
    };

    (request as any).user = authenticatedUser;

    return true;
  }

  // ---------------------------------------------------------------------------
  // HELPER — Extract Bearer token from Authorization header
  // ---------------------------------------------------------------------------

  private extractBearerToken(request: Request): string | null {
    const authHeader = request.headers['authorization'];
    if (!authHeader) return null;

    const [scheme, token] = authHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;

    return token;
  }
}
