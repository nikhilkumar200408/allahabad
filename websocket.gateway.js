"use strict";
// Core Banking Platform - WebSocket Service
// Real-time transaction updates, push notifications, and server-sent events
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var TransactionWebSocketGateway_1;
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketBroadcastService = exports.TransactionWebSocketGateway = void 0;
const common_1 = require("@nestjs/common");
const websockets_1 = require("@nestjs/websockets");
const socket_io_1 = require("socket.io");
const prisma_service_1 = require("./prisma.service");
const redis_service_1 = require("./redis.service");
const config_1 = require("@nestjs/config");
const jwt = __importStar(require("jsonwebtoken"));
// ============================================================================
// WEBSOCKET GATEWAY
// ============================================================================
let TransactionWebSocketGateway = TransactionWebSocketGateway_1 = class TransactionWebSocketGateway {
    constructor(prisma, redis, config) {
        this.prisma = prisma;
        this.redis = redis;
        this.config = config;
        this.logger = new common_1.Logger(TransactionWebSocketGateway_1.name);
        this.jwtSecret = process.env.JWT_SECRET || 'your-secret-key';
        // Track connected users: userId -> Set<socketId>
        this.userSessions = new Map();
    }
    /**
     * Initialize WebSocket event listeners on module startup
     */
    async onModuleInit() {
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
    async handleConnection(socket) {
        try {
            // Extract token from handshake auth
            const token = socket.handshake.auth.token;
            if (!token) {
                this.logger.warn('[WS-CONNECT] No auth token provided');
                socket.disconnect(true);
                return;
            }
            // Verify JWT token
            const decoded = jwt.verify(token, this.jwtSecret);
            const userId = decoded.sub;
            // Store user ID in socket data for later use
            socket.data.userId = userId;
            socket.data.connectedAt = new Date();
            // Track session
            if (!this.userSessions.has(userId)) {
                this.userSessions.set(userId, new Set());
            }
            this.userSessions.get(userId).add(socket.id);
            // Join room named after user ID for targeted messaging
            socket.join(`user:${userId}`);
            // Record in Redis for distributed tracking
            await this.redis.hset(`websocket:${userId}`, socket.id, JSON.stringify({
                socketId: socket.id,
                connectedAt: new Date().toISOString(),
                userAgent: socket.handshake.headers['user-agent'],
                ip: socket.handshake.address,
            }));
            this.logger.log(`[WS-CONNECTED] User: ${userId}, Socket: ${socket.id}`);
            // Send welcome message
            socket.emit('connection', {
                status: 'connected',
                message: 'Real-time connection established',
                userId,
            });
        }
        catch (error) {
            this.logger.error(`[WS-AUTH-ERROR] ${error.message}`);
            socket.disconnect(true);
        }
    }
    /**
     * Handle WebSocket disconnection
     * Cleanup session tracking and resources
     */
    async handleDisconnect(socket) {
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
            this.logger.log(`[WS-DISCONNECTED] User: ${userId}, Socket: ${socket.id}`);
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
    async subscribeToTransaction(socket, payload) {
        try {
            const userId = socket.data.userId;
            const { transactionId } = payload;
            // Verify user owns this transaction
            const transaction = await this.prisma.transaction.findUnique({
                where: { id: transactionId },
                select: { senderId: true, receiverId: true },
            });
            if (!transaction ||
                (transaction.senderId !== userId && transaction.receiverId !== userId)) {
                socket.emit('error', {
                    message: 'Access denied. You do not own this transaction.',
                });
                return;
            }
            // Join room for this transaction
            socket.join(`transaction:${transactionId}`);
            this.logger.log(`[WS-SUBSCRIBE] User: ${userId}, Transaction: ${transactionId}`);
            socket.emit('subscribed', {
                transactionId,
                message: 'Subscribed to transaction updates',
            });
        }
        catch (error) {
            this.logger.error(`[WS-SUBSCRIBE-ERROR] ${error.message}`);
            socket.emit('error', { message: error.message });
        }
    }
    /**
     * Subscribe to user account balance updates
     * Notifies when balance changes due to transactions
     */
    async subscribeToBalance(socket, payload) {
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
            this.logger.log(`[WS-SUBSCRIBE-BALANCE] User: ${userId}, Account: ${accountId}`);
            socket.emit('subscribed', {
                accountId,
                message: 'Subscribed to balance updates',
            });
        }
        catch (error) {
            this.logger.error(`[WS-SUBSCRIBE-BALANCE-ERROR] ${error.message}`);
            socket.emit('error', { message: error.message });
        }
    }
    /**
     * Unsubscribe from transaction updates
     */
    unsubscribeFromTransaction(socket, payload) {
        const { transactionId } = payload;
        socket.leave(`transaction:${transactionId}`);
        this.logger.log(`[WS-UNSUBSCRIBE] Socket: ${socket.id}, Transaction: ${transactionId}`);
    }
    // =========================================================================
    // BROADCAST METHODS (Called by services)
    // =========================================================================
    /**
     * Broadcast transaction status update
     * Called by TransferService when transaction state changes
     */
    async broadcastTransactionUpdate(transactionId, status, data) {
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
            this.logger.debug(`[WS-BROADCAST] Transaction: ${transactionId}, Status: ${status}`);
        }
        catch (error) {
            this.logger.error(`[WS-BROADCAST-ERROR] ${error.message}`);
        }
    }
    /**
     * Broadcast balance update
     * Called when account balance changes
     */
    async broadcastBalanceUpdate(accountId, newBalance) {
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
            this.logger.debug(`[WS-BALANCE-BROADCAST] Account: ${accountId}, Balance: ${newBalance}`);
        }
        catch (error) {
            this.logger.error(`[WS-BALANCE-BROADCAST-ERROR] ${error.message}`);
        }
    }
    /**
     * Send push notification to user
     * Used for important events (new transaction, payment received, etc.)
     */
    async sendNotification(userId, notification) {
        try {
            const payload = {
                ...notification,
                timestamp: new Date().toISOString(),
            };
            this.server
                .to(`user:${userId}`)
                .emit('notification', payload);
            // Also cache in Redis for offline delivery
            await this.redis.rpush(`notifications:${userId}`, JSON.stringify(payload));
            // Set 30-day expiry
            await this.redis.expire(`notifications:${userId}`, 30 * 24 * 60 * 60);
            this.logger.log(`[WS-NOTIFICATION] User: ${userId}, Title: ${notification.title}`);
        }
        catch (error) {
            this.logger.error(`[WS-NOTIFICATION-ERROR] ${error.message}`);
        }
    }
    // =========================================================================
    // HELPER: REDIS EVENT LISTENER
    // =========================================================================
    /**
     * Listen for events published to Redis by async job worker
     * Allows decoupling of services in distributed architecture
     */
    startRedisEventListener() {
        // In production, use Redis Pub/Sub or Redis Streams
        // This is a simplified polling approach for demonstration
        setInterval(async () => {
            try {
                // Poll for job status events
                const keys = await this.redis.lrange('events:*', 0, -1);
                // Process events (simplified - in production use proper Redis Pub/Sub)
                this.logger.debug('[REDIS-LISTENER] Polling for events');
            }
            catch (error) {
                this.logger.warn(`[REDIS-LISTENER-ERROR] ${error.message}`);
            }
        }, 5000);
    }
    /**
     * Get online status of user
     */
    async getUserStatus(userId) {
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
    getConnectedUserCount() {
        return this.userSessions.size;
    }
};
exports.TransactionWebSocketGateway = TransactionWebSocketGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], TransactionWebSocketGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)('subscribe:transaction'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], TransactionWebSocketGateway.prototype, "subscribeToTransaction", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('subscribe:balance'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", Promise)
], TransactionWebSocketGateway.prototype, "subscribeToBalance", null);
__decorate([
    (0, websockets_1.SubscribeMessage)('unsubscribe:transaction'),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], TransactionWebSocketGateway.prototype, "unsubscribeFromTransaction", null);
exports.TransactionWebSocketGateway = TransactionWebSocketGateway = TransactionWebSocketGateway_1 = __decorate([
    (0, websockets_1.WebSocketGateway)({
        cors: {
            origin: process.env.FRONTEND_URL || 'http://localhost:3000',
            credentials: true,
        },
        namespace: '/api/v1/realtime',
        transports: ['websocket', 'polling'], // Fallback to polling for restrictive networks
    }),
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [typeof (_a = typeof prisma_service_1.PrismaService !== "undefined" && prisma_service_1.PrismaService) === "function" ? _a : Object, redis_service_1.RedisService,
        config_1.ConfigService])
], TransactionWebSocketGateway);
// ============================================================================
// INJECTABLE SERVICE FOR TRIGGERING BROADCASTS
// ============================================================================
let WebSocketBroadcastService = class WebSocketBroadcastService {
    constructor(gateway) {
        this.gateway = gateway;
    }
    async notifyTransactionUpdate(transactionId, status, details) {
        await this.gateway.broadcastTransactionUpdate(transactionId, status, details);
    }
    async notifyBalanceUpdate(accountId, newBalance) {
        await this.gateway.broadcastBalanceUpdate(accountId, newBalance);
    }
    async sendUserNotification(userId, title, body, data) {
        await this.gateway.sendNotification(userId, { title, body, data });
    }
};
exports.WebSocketBroadcastService = WebSocketBroadcastService;
exports.WebSocketBroadcastService = WebSocketBroadcastService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [TransactionWebSocketGateway])
], WebSocketBroadcastService);
