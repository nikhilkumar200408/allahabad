// Core Banking Platform - WebSocket Service
// Real-time transaction updates, push notifications, and server-sent events

import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

// ============================================================================
// WEBSOCKET GATEWAY
// ============================================================================

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/api/v1/realtime',
  transports: ['websocket', 'polling'], // Fallback to polling for restrictive networks
})
@Injectable()
export class TransactionWebSocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() server: Server;

  private readonly logger = new Logger(TransactionWebSocketGateway.name);
  private readonly jwtSecret = process.env.JWT_SECRET || 'your-secret-key';

  // Track connected users: userId -> Set<socketId>
  private userSessions = new Map<string, Set<string>>();

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private config: ConfigService,
  ) {}

  /**
   * Initialize WebSocket event listeners on module startup
   */
  async onModuleInit(): Promise<void> {
    // Listen for job status updates from Redis (published by async worker)
    this.startRedisEventListener();

    this.logger.log('[WEBSOCKET-INIT] Real-time server initialized');
  }

  // =========================================================================
  // CONNECTION LIFECYCLE
  // =========================================================================

  /**
   * Handle new WebSocket connection
   * Authenticates user via JWT token and tracks session
   */
  async handleConnection(socket: Socket): Promise<void> {
    try {
      // Extract token from handshake auth
      const token = socket.handshake.auth.token;

      if (!token) {
        this.logger.warn('[WS-CONNECT] No auth token provided');
        socket.disconnect(true);
        return;
      }

      // Verify JWT token
      const decoded = jwt.verify(token, this.jwtSecret) as {
        sub: string;
        email: string;
      };
      const userId = decoded.sub;

      // Store user ID in socket data for later use
      socket.data.userId = userId;
      socket.data.connectedAt = new Date();

      // Track session
      if (!this.userSessions.has(userId)) {
        this.userSessions.set(userId, new Set());
      }
      this.userSessions.get(userId)!.add(socket.id);

      // Join room named after user ID for targeted messaging
      socket.join(`user:${userId}`);

      // Record in Redis for distributed tracking
      await this.redis.hset(
        `websocket:${userId}`,
        socket.id,
        JSON.stringify({
          socketId: socket.id,
          connectedAt: new Date().toISOString(),
          userAgent: socket.handshake.headers['user-agent'],
          ip: socket.handshake.address,
        }),
      );

      this.logger.log(
        `[WS-CONNECTED] User: ${userId}, Socket: ${socket.id}`,
      );

      // Send welcome message
      socket.emit('connection', {
        status: 'connected',
        message: 'Real-time connection established',
        userId,
      });
    } catch (error) {
      this.logger.error(`[WS-AUTH-ERROR] ${error.message}`);
      socket.disconnect(true);
    }
  }

  /**
   * Handle WebSocket disconnection
   * Cleanup session tracking and resources
   */
  async handleDisconnect(socket: Socket): Promise<void> {
    const userId = socket.data.userId;

    if (userId) {
      // Remove from session tracking
      const sessions = this.userSessions.get(userId);
      if (sessions) {
        sessions.delete(socket.id);
        if (sessions.size === 0) {
          this.userSessions.delete(userId);
        }
      }

      // Remove from Redis
      await this.redis.hdel(`websocket:${userId}`, socket.id).catch((err) => {
        this.logger.warn(`[REDIS-HDEL-ERROR] ${err.message}`);
      });

      this.logger.log(
        `[WS-DISCONNECTED] User: ${userId}, Socket: ${socket.id}`,
      );
    }
  }

  // =========================================================================
  // SUBSCRIPTION HANDLERS
  // =========================================================================

  /**
   * Subscribe to transaction updates for specific transaction
   * Client sends: { transactionId: string }
   * Server emits: TransactionUpdated events when status changes
   */
  @SubscribeMessage('subscribe:transaction')
  async subscribeToTransaction(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { transactionId: string },
  ): Promise<void> {
    try {
      const userId = socket.data.userId;
      const { transactionId } = payload;

      // Verify user owns this transaction
      const transaction = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
        select: { senderId: true, receiverId: true },
      });

      if (
        !transaction ||
        (transaction.senderId !== userId && transaction.receiverId !== userId)
      ) {
        socket.emit('error', {
          message: 'Access denied. You do not own this transaction.',
        });
        return;
      }

      // Join room for this transaction
      socket.join(`transaction:${transactionId}`);

      this.logger.log(
        `[WS-SUBSCRIBE] User: ${userId}, Transaction: ${transactionId}`,
      );

      socket.emit('subscribed', {
        transactionId,
        message: 'Subscribed to transaction updates',
      });
    } catch (error) {
      this.logger.error(
        `[WS-SUBSCRIBE-ERROR] ${error.message}`,
      );
      socket.emit('error', { message: error.message });
    }
  }

  /**
   * Subscribe to user account balance updates
   * Notifies when balance changes due to transactions
   */
  @SubscribeMessage('subscribe:balance')
  async subscribeToBalance(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { accountId: string },
  ): Promise<void> {
    try {
      const userId = socket.data.userId;
      const { accountId } = payload;

      // Verify user owns this account
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
        select: { userId: true },
      });

      if (!account || account.userId !== userId) {
        socket.emit('error', {
          message: 'Access denied. You do not own this account.',
        });
        return;
      }

      socket.join(`account:${accountId}`);

      this.logger.log(
        `[WS-SUBSCRIBE-BALANCE] User: ${userId}, Account: ${accountId}`,
      );

      socket.emit('subscribed', {
        accountId,
        message: 'Subscribed to balance updates',
      });
    } catch (error) {
      this.logger.error(
        `[WS-SUBSCRIBE-BALANCE-ERROR] ${error.message}`,
      );
      socket.emit('error', { message: error.message });
    }
  }

  /**
   * Unsubscribe from transaction updates
   */
  @SubscribeMessage('unsubscribe:transaction')
  unsubscribeFromTransaction(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { transactionId: string },
  ): void {
    const { transactionId } = payload;
    socket.leave(`transaction:${transactionId}`);

    this.logger.log(
      `[WS-UNSUBSCRIBE] Socket: ${socket.id}, Transaction: ${transactionId}`,
    );
  }

  // =========================================================================
  // BROADCAST METHODS (Called by services)
  // =========================================================================

  /**
   * Broadcast transaction status update
   * Called by TransferService when transaction state changes
   */
  async broadcastTransactionUpdate(
    transactionId: string,
    status: string,
    data: Record<string, any>,
  ): Promise<void> {
    try {
      const transaction = await this.prisma.transaction.findUnique({
        where: { id: transactionId },
      });

      if (!transaction) {
        return;
      }

      const payload = {
        transactionId,
        status,
        timestamp: new Date().toISOString(),
        ...data,
      };

      // Send to all clients subscribed to this transaction
      this.server
        .to(`transaction:${transactionId}`)
        .emit('transaction:updated', payload);

      // Also notify specific users (sender and receiver)
      this.server
        .to(`user:${transaction.senderId}`)
        .emit('transaction:updated', payload);
      this.server
        .to(`user:${transaction.receiverId}`)
        .emit('transaction:updated', payload);

      this.logger.debug(
        `[WS-BROADCAST] Transaction: ${transactionId}, Status: ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `[WS-BROADCAST-ERROR] ${error.message}`,
      );
    }
  }

  /**
   * Broadcast balance update
   * Called when account balance changes
   */
  async broadcastBalanceUpdate(
    accountId: string,
    newBalance: string,
  ): Promise<void> {
    try {
      const account = await this.prisma.account.findUnique({
        where: { id: accountId },
        select: { userId: true },
      });

      if (!account) {
        return;
      }

      const payload = {
        accountId,
        newBalance,
        timestamp: new Date().toISOString(),
      };

      // Send to all clients subscribed to this account
      this.server
        .to(`account:${accountId}`)
        .emit('balance:updated', payload);

      // Also notify the user
      this.server
        .to(`user:${account.userId}`)
        .emit('balance:updated', payload);

      this.logger.debug(
        `[WS-BALANCE-BROADCAST] Account: ${accountId}, Balance: ${newBalance}`,
      );
    } catch (error) {
      this.logger.error(
        `[WS-BALANCE-BROADCAST-ERROR] ${error.message}`,
      );
    }
  }

  /**
   * Send push notification to user
   * Used for important events (new transaction, payment received, etc.)
   */
  async sendNotification(
    userId: string,
    notification: {
      title: string;
      body: string;
      data?: Record<string, any>;
    },
  ): Promise<void> {
    try {
      const payload = {
        ...notification,
        timestamp: new Date().toISOString(),
      };

      this.server
        .to(`user:${userId}`)
        .emit('notification', payload);

      // Also cache in Redis for offline delivery
      await this.redis.rpush(
        `notifications:${userId}`,
        JSON.stringify(payload),
      );

      // Set 30-day expiry
      await this.redis.expire(
        `notifications:${userId}`,
        30 * 24 * 60 * 60,
      );

      this.logger.log(
        `[WS-NOTIFICATION] User: ${userId}, Title: ${notification.title}`,
      );
    } catch (error) {
      this.logger.error(
        `[WS-NOTIFICATION-ERROR] ${error.message}`,
      );
    }
  }

  // =========================================================================
  // HELPER: REDIS EVENT LISTENER
  // =========================================================================

  /**
   * Listen for events published to Redis by async job worker
   * Allows decoupling of services in distributed architecture
   */
  private startRedisEventListener(): void {
    // In production, use Redis Pub/Sub or Redis Streams
    // This is a simplified polling approach for demonstration

    setInterval(async () => {
      try {
        // Poll for job status events
        const keys = await this.redis.lrange('events:*', 0, -1);

        // Process events (simplified - in production use proper Redis Pub/Sub)
        this.logger.debug('[REDIS-LISTENER] Polling for events');
      } catch (error) {
        this.logger.warn(`[REDIS-LISTENER-ERROR] ${error.message}`);
      }
    }, 5000);
  }

  /**
   * Get online status of user
   */
  async getUserStatus(userId: string): Promise<{
    isOnline: boolean;
    socketCount: number;
    lastActivity?: Date;
  }> {
    const sessions = this.userSessions.get(userId);

    return {
      isOnline: !!sessions && sessions.size > 0,
      socketCount: sessions?.size || 0,
      lastActivity: new Date(), // Can be enhanced with actual tracking
    };
  }

  /**
   * Get total connected users
   */
  getConnectedUserCount(): number {
    return this.userSessions.size;
  }
}

// ============================================================================
// INJECTABLE SERVICE FOR TRIGGERING BROADCASTS
// ============================================================================

@Injectable()
export class WebSocketBroadcastService {
  constructor(
    private gateway: TransactionWebSocketGateway,
  ) {}

  async notifyTransactionUpdate(
    transactionId: string,
    status: string,
    details: Record<string, any>,
  ): Promise<void> {
    await this.gateway.broadcastTransactionUpdate(
      transactionId,
      status,
      details,
    );
  }

  async notifyBalanceUpdate(
    accountId: string,
    newBalance: string,
  ): Promise<void> {
    await this.gateway.broadcastBalanceUpdate(accountId, newBalance);
  }

  async sendUserNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, any>,
  ): Promise<void> {
    await this.gateway.sendNotification(userId, { title, body, data });
  }
}
