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
    onModuleInit(): Promise<void>;
    handleConnection(socket: Socket): Promise<void>;
    handleDisconnect(socket: Socket): Promise<void>;
    subscribeToTransaction(socket: Socket, payload: {
        transactionId: string;
    }): Promise<void>;
    subscribeToBalance(socket: Socket, payload: {
        accountId: string;
    }): Promise<void>;
    unsubscribeFromTransaction(socket: Socket, payload: {
        transactionId: string;
    }): void;
    broadcastTransactionUpdate(transactionId: string, status: string, data: Record<string, any>): Promise<void>;
    broadcastBalanceUpdate(accountId: string, newBalance: string): Promise<void>;
    sendNotification(userId: string, notification: {
        title: string;
        body: string;
        data?: Record<string, any>;
    }): Promise<void>;
    private startRedisEventListener;
    getUserStatus(userId: string): Promise<{
        isOnline: boolean;
        socketCount: number;
        lastActivity?: Date;
    }>;
    getConnectedUserCount(): number;
}
export declare class WebSocketBroadcastService {
    private gateway;
    constructor(gateway: TransactionWebSocketGateway);
    notifyTransactionUpdate(transactionId: string, status: string, details: Record<string, any>): Promise<void>;
    notifyBalanceUpdate(accountId: string, newBalance: string): Promise<void>;
    sendUserNotification(userId: string, title: string, body: string, data?: Record<string, any>): Promise<void>;
}
