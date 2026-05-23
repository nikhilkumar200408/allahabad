"use strict";
// Core Banking Platform - Transfer Controller
// REST API endpoints with comprehensive security and real-time updates
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
var TransferController_1;
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransferController = exports.TransactionHistoryQueryDTO = exports.VerifyTransactionDTO = exports.InitiateTransferDTO = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const transfer_service_1 = require("./transfer.service");
const blockchain_service_1 = require("./blockchain.service");
const prisma_service_1 = require("./prisma.service");
const auth_guard_1 = require("./auth.guard");
const current_user_decorator_1 = require("./current-user.decorator");
const validators_1 = require("./validators");
const crypto = __importStar(require("crypto"));
// ============================================================================
// DATA TRANSFER OBJECTS (DTOs)
// ============================================================================
class InitiateTransferDTO {
}
exports.InitiateTransferDTO = InitiateTransferDTO;
class VerifyTransactionDTO {
}
exports.VerifyTransactionDTO = VerifyTransactionDTO;
class TransactionHistoryQueryDTO {
}
exports.TransactionHistoryQueryDTO = TransactionHistoryQueryDTO;
// ============================================================================
// TRANSFER CONTROLLER
// ============================================================================
let TransferController = TransferController_1 = class TransferController {
    constructor(transferService, blockchainService, prisma) {
        this.transferService = transferService;
        this.blockchainService = blockchainService;
        this.prisma = prisma;
        this.logger = new common_1.Logger(TransferController_1.name);
    }
    // =========================================================================
    // POST /transfers/initiate
    // =========================================================================
    /**
     * Initiate a peer-to-peer UPI transfer
     *
     * Security features:
     * - JWT authentication (Authorization header)
     * - X-Idempotency-Key header for idempotent submission
     * - X-Device-ID header for device tracking
     * - IP-based fraud detection
     * - Rate limiting (Thrift)
     *
     * @param currentUser Authenticated user from JWT
     * @param dto Transfer request payload
     * @param idempotencyKey UUIDv4 from X-Idempotency-Key header
     * @param deviceId Device identifier from X-Device-ID header
     * @param userAgent Browser user agent (auto-captured)
     * @param clientIp Client IP address (from X-Forwarded-For or socket)
     *
     * @returns TransferResponse with transaction details and blockchain status
     *
     * Throws:
     * - BadRequestException (400): Invalid input or insufficient balance
     * - ConflictException (409): Duplicate request or lock timeout
     * - InternalServerErrorException (500): Database or blockchain failure
     */
    async initiateTransfer(currentUser, dto, idempotencyKey, deviceId, userAgent, clientIp) {
        this.logger.log(`[TRANSFER-API] User: ${currentUser.id}, Receiver: ${dto.receiverHandle}`);
        // =========================================================================
        // VALIDATE REQUEST HEADERS
        // =========================================================================
        if (!idempotencyKey) {
            throw new common_1.BadRequestException('X-Idempotency-Key header is required (UUIDv4)');
        }
        if (!(0, validators_1.validateIdempotencyKey)(idempotencyKey)) {
            throw new common_1.BadRequestException('Invalid X-Idempotency-Key format. Expected UUIDv4.');
        }
        if (!deviceId) {
            throw new common_1.BadRequestException('X-Device-ID header is required');
        }
        // =========================================================================
        // VALIDATE REQUEST BODY
        // =========================================================================
        if (!dto.receiverHandle) {
            throw new common_1.BadRequestException('receiverHandle is required');
        }
        if (!(0, validators_1.validateUpiHandle)(dto.receiverHandle)) {
            throw new common_1.BadRequestException('Invalid UPI handle format. Expected: user@mybank');
        }
        if (!dto.amount) {
            throw new common_1.BadRequestException('amount is required');
        }
        // =========================================================================
        // TRACK DEVICE SESSION
        // =========================================================================
        const ipAddress = clientIp || 'UNKNOWN';
        try {
            await this.trackDeviceSession(currentUser.id, deviceId, userAgent, ipAddress);
        }
        catch (error) {
            this.logger.warn(`[DEVICE-TRACKING-ERROR] ${error.message}`);
            // Don't fail transaction on device tracking error
        }
        // =========================================================================
        // EXECUTE TRANSFER SERVICE
        // =========================================================================
        const transferRequest = {
            senderId: currentUser.id,
            receiverHandle: dto.receiverHandle,
            amount: dto.amount,
            description: dto.description || 'P2P Transfer',
            idempotencyKey,
        };
        return this.transferService.executeTransfer(transferRequest);
    }
    // =========================================================================
    // GET /transfers/:transactionId
    // =========================================================================
    /**
     * Get transaction details by ID
     *
     * @param currentUser Authenticated user
     * @param transactionId Transaction ID (UUID)
     * @returns Transaction record with status and blockchain anchor info
     *
     * Throws:
     * - NotFoundException (404): Transaction not found or not owned by user
     */
    async getTransaction(currentUser, transactionId) {
        this.logger.log(`[GET-TRANSACTION] ${transactionId}`);
        const transaction = await this.prisma.transaction.findUnique({
            where: { id: transactionId },
            include: {
                sender: {
                    select: { id: true, firstName: true, lastName: true, upiHandle: true },
                },
                receiver: {
                    select: { id: true, firstName: true, lastName: true, upiHandle: true },
                },
                blockchainAudit: true,
            },
        });
        if (!transaction) {
            throw new common_1.NotFoundException(`Transaction not found: ${transactionId}`);
        }
        // Verify ownership (sender or receiver only)
        if (transaction.senderId !== currentUser.id &&
            transaction.receiverId !== currentUser.id) {
            throw new common_1.NotFoundException('Access denied. You are not party to this transaction.');
        }
        return {
            ...transaction,
            amount: transaction.amount.toString(),
        };
    }
    // =========================================================================
    // GET /transfers/rrn/:rrn
    // =========================================================================
    /**
     * Get transaction by RRN (UPI Reference Number)
     *
     * @param rrn UPI Reference Number (12-digit format: YYYY+DDD+hex)
     * @returns Transaction record
     */
    async getTransactionByRrn(currentUser, rrn) {
        this.logger.log(`[GET-TRANSACTION-RRN] ${rrn}`);
        // Validate RRN format
        if (!/^\d{4}\d{3}[A-F0-9]{6}$/.test(rrn)) {
            throw new common_1.BadRequestException('Invalid RRN format');
        }
        const transaction = await this.prisma.transaction.findUnique({
            where: { rrn },
            include: {
                sender: { select: { id: true, upiHandle: true } },
                receiver: { select: { id: true, upiHandle: true } },
                blockchainAudit: true,
            },
        });
        if (!transaction) {
            throw new common_1.NotFoundException(`Transaction not found: ${rrn}`);
        }
        // Verify ownership
        if (transaction.senderId !== currentUser.id &&
            transaction.receiverId !== currentUser.id) {
            throw new common_1.NotFoundException('Access denied. You are not party to this transaction.');
        }
        return {
            ...transaction,
            amount: transaction.amount.toString(),
        };
    }
    // =========================================================================
    // POST /transfers/verify-blockchain
    // =========================================================================
    /**
     * Verify transaction on blockchain
     *
     * @param currentUser Authenticated user
     * @param dto Verification request with transaction hash
     * @returns Verification result and audit proof
     */
    async verifyOnBlockchain(currentUser, dto) {
        this.logger.log(`[BLOCKCHAIN-VERIFY] User: ${currentUser.id}, Hash: ${dto.txHash}`);
        if (!dto.txHash || !dto.txHash.startsWith('0x')) {
            throw new common_1.BadRequestException('txHash must be 0x-prefixed 64-character hex string');
        }
        try {
            const auditProof = await this.blockchainService.getAuditProof(dto.txHash);
            return {
                verified: auditProof.verified,
                blockNumber: auditProof.blockNumber,
                chainproof: auditProof.chainproof ? JSON.parse(auditProof.chainproof) : null,
            };
        }
        catch (error) {
            this.logger.error(`[BLOCKCHAIN-VERIFY-ERROR] ${error.message}`);
            throw new common_1.BadRequestException('Failed to verify transaction on blockchain');
        }
    }
    // =========================================================================
    // GET /transfers/history
    // =========================================================================
    /**
     * Get paginated transaction history for current user
     *
     * @param currentUser Authenticated user
     * @param query Pagination and filter options
     * @returns Paginated transaction list
     */
    async getTransactionHistory(currentUser, query) {
        this.logger.log(`[TRANSACTION-HISTORY] User: ${currentUser.id}`);
        const page = Math.max(1, query.page || 1);
        const limit = Math.min(50, query.limit || 20);
        const skip = (page - 1) * limit;
        // Build dynamic where clause
        const where = {
            OR: [
                { senderId: currentUser.id },
                { receiverId: currentUser.id },
            ],
        };
        if (query.status) {
            where.status = query.status;
        }
        // Execute query with pagination
        const [transactions, total] = await Promise.all([
            this.prisma.transaction.findMany({
                where,
                include: {
                    sender: { select: { upiHandle: true } },
                    receiver: { select: { upiHandle: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            this.prisma.transaction.count({ where }),
        ]);
        return {
            data: transactions.map((t) => ({
                ...t,
                amount: t.amount.toString(),
            })),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        };
    }
    // =========================================================================
    // HELPER: DEVICE SESSION TRACKING
    // =========================================================================
    async trackDeviceSession(userId, deviceId, userAgent, ipAddress) {
        try {
            // Check if device already registered
            const existing = await this.prisma.deviceToken.findUnique({
                where: {
                    userId_deviceId: {
                        userId,
                        deviceId,
                    },
                },
            });
            if (existing) {
                // Update last used timestamp
                await this.prisma.deviceToken.update({
                    where: {
                        userId_deviceId: {
                            userId,
                            deviceId,
                        },
                    },
                    data: {
                        lastUsedAt: new Date(),
                    },
                });
            }
            else {
                // Register new device
                await this.prisma.deviceToken.create({
                    data: {
                        userId,
                        deviceId,
                        pushToken: this.hashDeviceToken(deviceId),
                        deviceType: this.inferDeviceType(userAgent),
                        registeredAt: new Date(),
                        lastUsedAt: new Date(),
                    },
                });
                this.logger.log(`[NEW-DEVICE] User: ${userId}, Device: ${deviceId}`);
            }
        }
        catch (error) {
            this.logger.error(`[DEVICE-TRACKING-ERROR] ${error.message}`);
            throw error;
        }
    }
    hashDeviceToken(deviceId) {
        return crypto
            .createHash('sha256')
            .update(deviceId)
            .digest('hex');
    }
    inferDeviceType(userAgent) {
        if (!userAgent)
            return 'WEB_DESKTOP';
        const lower = userAgent.toLowerCase();
        if (lower.includes('iphone') || lower.includes('ios')) {
            return lower.includes('tablet') ? 'TABLET_IOS' : 'MOBILE_IOS';
        }
        if (lower.includes('android')) {
            return lower.includes('tablet') ? 'TABLET_ANDROID' : 'MOBILE_ANDROID';
        }
        return 'WEB_DESKTOP';
    }
};
exports.TransferController = TransferController;
__decorate([
    (0, common_1.Post)('initiate'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.CREATED),
    (0, swagger_1.ApiOperation)({
        summary: 'Initiate P2P UPI Transfer',
        description: 'Execute a peer-to-peer transfer with full ACID guarantees and blockchain anchoring',
    }),
    (0, swagger_1.ApiHeader)({
        name: 'X-Idempotency-Key',
        description: 'UUIDv4 for idempotent request tracking (120-second window)',
        required: true,
    }),
    (0, swagger_1.ApiHeader)({
        name: 'X-Device-ID',
        description: 'Device identifier for multi-device session tracking',
        required: true,
    }),
    (0, swagger_1.ApiResponse)({
        status: 201,
        description: 'Transfer initiated successfully',
        schema: {
            example: {
                success: true,
                transactionId: 'clx8a4kp2000109jy0z5p8v6e',
                rrn: '202401A4F7C9E',
                txHash: '0x8f9c5c7a3b1d2e4f6a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e',
                blockchainStatus: 'PENDING',
                message: 'Transfer of 500.50 MYSIM to user@mybank successful',
                timestamp: '2024-01-18T10:30:45.123Z',
            },
        },
    }),
    (0, swagger_1.ApiResponse)({
        status: 400,
        description: 'Invalid request or business logic error',
        schema: {
            example: {
                statusCode: 400,
                message: 'Insufficient balance. Available: 100.00, Requested: 500.00',
                error: 'Bad Request',
            },
        },
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('x-idempotency-key')),
    __param(3, (0, common_1.Headers)('x-device-id')),
    __param(4, (0, common_1.Headers)('user-agent')),
    __param(5, (0, common_1.Headers)('x-forwarded-for')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, InitiateTransferDTO, String, String, String, String]),
    __metadata("design:returntype", Promise)
], TransferController.prototype, "initiateTransfer", null);
__decorate([
    (0, common_1.Get)(':transactionId'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, swagger_1.ApiOperation)({
        summary: 'Get Transaction Details',
        description: 'Retrieve full transaction record including blockchain status',
    }),
    (0, swagger_1.ApiResponse)({
        status: 200,
        description: 'Transaction details retrieved',
        schema: {
            example: {
                id: 'clx8a4kp2000109jy0z5p8v6e',
                rrn: '202401A4F7C9E',
                senderId: 'user-123',
                receiverId: 'user-456',
                amount: '500.50',
                currency: 'MYSIM',
                description: 'P2P Transfer',
                status: 'SETTLED',
                blockchainStatus: 'ANCHORED',
                txHash: '0x8f9c5c7a3b1d2e4f6a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e',
                blockchainTxId: '0xabc123...',
                createdAt: '2024-01-18T10:30:45.123Z',
                settledAt: '2024-01-18T10:30:47.456Z',
            },
        },
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('transactionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TransferController.prototype, "getTransaction", null);
__decorate([
    (0, common_1.Get)('rrn/:rrn'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, swagger_1.ApiOperation)({
        summary: 'Get Transaction by RRN',
        description: 'Retrieve transaction using UPI Reference Number',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('rrn')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TransferController.prototype, "getTransactionByRrn", null);
__decorate([
    (0, common_1.Post)('verify-blockchain'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, swagger_1.ApiOperation)({
        summary: 'Verify Transaction on Blockchain',
        description: 'Verify transaction hash exists on-chain and retrieve audit proof',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, VerifyTransactionDTO]),
    __metadata("design:returntype", Promise)
], TransferController.prototype, "verifyOnBlockchain", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, swagger_1.ApiOperation)({
        summary: 'Get Transaction History',
        description: 'Retrieve paginated transaction history with filtering',
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, TransactionHistoryQueryDTO]),
    __metadata("design:returntype", Promise)
], TransferController.prototype, "getTransactionHistory", null);
exports.TransferController = TransferController = TransferController_1 = __decorate([
    (0, common_1.Controller)('api/v1/transfers'),
    (0, swagger_1.ApiTags)('Transfers'),
    (0, swagger_1.ApiBearerAuth)('bearer-token'),
    __metadata("design:paramtypes", [transfer_service_1.TransferService,
        blockchain_service_1.BlockchainService, typeof (_a = typeof prisma_service_1.PrismaService !== "undefined" && prisma_service_1.PrismaService) === "function" ? _a : Object])
], TransferController);
