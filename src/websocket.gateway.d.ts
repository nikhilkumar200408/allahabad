import { OnModuleInit } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { ConfigService } from '@nestjs/config';
export declare class TransactionWebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
    private prisma;
    private redis;
    private config;
    server: Server;
    private readonly logger;
    private readonly jwtSecret;
    private userSessions;
    constructor(prisma: PrismaService, redis: RedisService, config: ConfigService);
    /**
     * Initialize WebSocket event listeners on module startup
     */
    onModuleInit(): Promise<void>;
    /**
     * Handle new WebSocket connection
     * Authenticates user via JWT token and tracks session
     */
    handleConnection(socket: Socket): Promise<void>;
    /**
     * Handle WebSocket disconnection
     * Cleanup session tracking and resources
     */
    handleDisconnect(socket: Socket): Promise<void>;
    /**
     * Subscribe to transaction updates for specific transaction
     * Client sends: { transactionId: string }
     * Server emits: TransactionUpdated events when status changes
     */
    subscribeToTransaction(socket: Socket, payload: {
        transactionId: string;
    }): Promise<void>;
    /**
     * Subscribe to user account balance updates
     * Notifies when balance changes due to transactions
     */
    subscribeToBalance(socket: Socket, payload: {
        accountId: string;
    }): Promise<void>;
    /**
     * Unsubscribe from transaction updates
     */
    unsubscribeFromTransaction(socket: Socket, payload: {
        transactionId: string;
    }): void;
    /**
     * Broadcast transaction status update
     * Called by TransferService when transaction state changes
     */
    broadcastTransactionUpdate(transactionId: string, status: string, data: Record<string, any>): Promise<void>;
    /**
     * Broadcast balance update
     * Called when account balance changes
     */
    broadcastBalanceUpdate(accountId: string, newBalance: string): Promise<void>;
    /**
     * Send push notification to user
     * Used for important events (new transaction, payment received, etc.)
     */
    sendNotification(userId: string, notification: {
        title: string;
        body: string;
        data?: Record<string, any>;
    }): Promise<void>;
    /**
     * Listen for events published to Redis by async job worker
     * Allows decoupling of services in distributed architecture
     */
    private startRedisEventListener;
    /**
     * Get online status of user
     */
    getUserStatus(userId: string): Promise<{
        isOnline: boolean;
        socketCount: number;
        lastActivity?: Date;
    }>;
    /**
     * Get total connected users
     */
    getConnectedUserCount(): number;
}
export declare class WebSocketBroadcastService {
    private gateway;
    constructor(gateway: TransactionWebSocketGateway);
    notifyTransactionUpdate(transactionId: string, status: string, details: Record<string, any>): Promise<void>;
    notifyBalanceUpdate(accountId: string, newBalance: string): Promise<void>;
    sendUserNotification(userId: string, title: string, body: string, data?: Record<string, any>): Promise<void>;
}
