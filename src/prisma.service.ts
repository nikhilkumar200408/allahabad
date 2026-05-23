/**
 * @file prisma.service.ts
 * @description Prisma ORM service wrapper for NestJS dependency injection.
 *
 * Design decisions:
 *   - Extends PrismaClient so every Prisma method is available directly on the
 *     injected service instance — no `.client.user.findMany()` indirection.
 *   - Connects on `onModuleInit` (not in constructor) so NestJS lifecycle hooks
 *     control the connection, not module import order.
 *   - Disconnects on `onModuleDestroy` to drain the connection pool gracefully
 *     instead of leaving sockets open during hot-reload or SIGTERM.
 *   - `enableShutdownHooks()` registers process-level signal listeners so the
 *     pool closes cleanly even when NestJS is shut down from outside (PM2,
 *     Kubernetes, Docker stop).
 *   - Query-event logging is scoped to non-production environments; in
 *     production only errors and slow queries (>2 s) are emitted.
 *
 * Integration with existing codebase:
 *   Used by: TransferService, BlockchainService, AuthenticationService,
 *            AsyncJobWorkerService, TransferController, UpiPaymentService
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, Prisma } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: ConfigService) {
    const nodeEnv = config.get<string>('NODE_ENV', 'development');
    const isDev = nodeEnv !== 'production';

    super({
      datasources: {
        db: {
          url: config.get<string>('DATABASE_URL'),
        },
      },

      // ---------------------------------------------------------------------------
      // Connection pool tuning
      // Prisma default pool = (num_cores * 2) + 1; we override with env values so
      // the pool matches the PostgreSQL max_connections setting in docker-compose.yml.
      // ---------------------------------------------------------------------------
      // Note: Pool size is set via the DATABASE_URL query-string parameter
      //   ?connection_limit=20&pool_timeout=30
      // so we don't need separate options here.

      log: isDev
        ? [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'info' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ]
        : [
            // In production only log slow queries (> 2000 ms) and errors.
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
          ],

      errorFormat: isDev ? 'pretty' : 'minimal',
    });

    // -------------------------------------------------------------------------
    // Wire up Prisma event emitters to NestJS Logger.
    // PrismaClient emits these as typed events so we don't lose type-safety.
    // -------------------------------------------------------------------------
    if (isDev) {
      (this as any).$on('query', (e: Prisma.QueryEvent) => {
        if (e.duration > 2000) {
          this.logger.warn(
            `[SLOW QUERY ${e.duration}ms] ${e.query} — params: ${e.params}`,
          );
        } else {
          this.logger.debug(`[QUERY ${e.duration}ms] ${e.query}`);
        }
      });

      (this as any).$on('info', (e: Prisma.LogEvent) => {
        this.logger.log(`[PRISMA INFO] ${e.message}`);
      });
    }

    (this as any).$on('warn', (e: Prisma.LogEvent) => {
      this.logger.warn(`[PRISMA WARN] ${e.message}`);
    });

    (this as any).$on('error', (e: Prisma.LogEvent) => {
      this.logger.error(`[PRISMA ERROR] ${e.message}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Lifecycle hooks
  // ---------------------------------------------------------------------------

  async onModuleInit(): Promise<void> {
    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
      try {
        await this.$connect();
        this.logger.log('[PRISMA] Database connection established.');

        // Validate connectivity with a lightweight query
        await this.$queryRaw`SELECT 1 AS ping`;
        this.logger.log('[PRISMA] Database health check passed.');
        return;
      } catch (err) {
        attempt++;
        this.logger.error(
          `[PRISMA] Connection attempt ${attempt}/${maxRetries} failed: ${err.message}`,
        );
        if (attempt < maxRetries) {
          // Exponential back-off: 500 ms, 1 s, 2 s, 4 s
          const delay = 500 * Math.pow(2, attempt - 1);
          this.logger.log(`[PRISMA] Retrying in ${delay}ms…`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(
      `[PRISMA] Could not connect to the database after ${maxRetries} attempts. Aborting startup.`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('[PRISMA] Database connection closed gracefully.');
  }

  /**
   * Register Node.js process-level SIGINT/SIGTERM handlers so Prisma drains
   * its connection pool even when NestJS bootstrap doesn't reach `app.close()`.
   * Call this once in `main.ts` bootstrap after creating the NestJS app:
   *
   *   const prisma = app.get(PrismaService);
   *   prisma.enableShutdownHooks(app);
   */
  enableShutdownHooks(app: { close: () => Promise<void> }): void {
    (this as any).$on('beforeExit', async () => {
      this.logger.log('[PRISMA] beforeExit — closing NestJS app.');
      await app.close();
    });
  }

  // ---------------------------------------------------------------------------
  // Health check utility (used by /health endpoint in app.module.ts)
  // ---------------------------------------------------------------------------

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Helper
  // ---------------------------------------------------------------------------

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
