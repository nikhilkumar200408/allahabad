"use strict";
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
var TransferService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransferService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("./prisma.service");
const redis_service_1 = require("./redis.service");
const blockchain_service_1 = require("./blockchain.service");
const client_1 = require("@prisma/client");
const uuid_1 = require("uuid");
const library_1 = require("@prisma/client/runtime/library");
const crypto = __importStar(require("crypto"));
let TransferService = TransferService_1 = class TransferService {
    constructor(prisma, redis, blockchain) {
        this.prisma = prisma;
        this.redis = redis;
        this.blockchain = blockchain;
        this.logger = new common_1.Logger(TransferService_1.name);
        this.LOCK_TIMEOUT_MS = 30000;
        this.IDEMPOTENCY_WINDOW_SEC = 120;
    }
    async executeTransfer(request) {
        this.logger.log(`[TRANSFER] Starting P2P transfer: ${request.senderId} -> ${request.receiverHandle}`);
        let senderAccountId = null;
        let receiverAccountId = null;
        let transaction = null;
        try {
            const cachedResponse = await this.checkIdempotency(request.senderId, request.idempotencyKey);
            if (cachedResponse) {
                this.logger.warn(`[IDEMPOTENCY] Duplicate request detected: ${request.idempotencyKey}`);
                return JSON.parse(cachedResponse);
            }
            this.validateTransferRequest(request);
            const receiver = await this.prisma.user.findUnique({
                where: { upiHandle: request.receiverHandle },
                include: { accounts: { where: { status: 'ACTIVE' } } },
            });
            if (!receiver) {
                throw new common_1.BadRequestException(`Receiver UPI handle not found: ${request.receiverHandle}`);
            }
            if (!receiver.accounts.length) {
                throw new common_1.BadRequestException(`Receiver has no active account: ${request.receiverHandle}`);
            }
            const [senderAccount, receiverAccount] = await Promise.all([
                this.prisma.account.findFirst({
                    where: {
                        userId: request.senderId,
                        status: 'ACTIVE',
                    },
                }),
                this.prisma.account.findFirst({
                    where: {
                        userId: receiver.id,
                        status: 'ACTIVE',
                    },
                }),
            ]);
            if (!senderAccount) {
                throw new common_1.BadRequestException(`Sender account not found or inactive: ${request.senderId}`);
            }
            if (!receiverAccount) {
                throw new common_1.BadRequestException(`Receiver account not found or inactive`);
            }
            senderAccountId = senderAccount.id;
            receiverAccountId = receiverAccount.id;
            const lockKeys = this.sortLockKeys(senderAccountId, receiverAccountId);
            const locks = await this.acquireDistributedLocks(lockKeys);
            if (!locks || locks.length !== 2) {
                throw new common_1.ConflictException('Could not acquire transaction locks. Please retry.');
            }
            const currentBalance = await this.getLockedBalance(senderAccountId);
            const transferAmount = new library_1.Decimal(request.amount);
            if (currentBalance.lessThan(transferAmount)) {
                throw new common_1.BadRequestException(`Insufficient balance. Available: ${currentBalance.toString()}, Requested: ${transferAmount.toString()}`);
            }
            const rrn = this.generateRRN();
            const idempotencyKey = request.idempotencyKey;
            const txHash = this.generateTransactionHash({
                senderId: request.senderId,
                receiverId: receiver.id,
                amount: transferAmount.toString(),
                timestamp: new Date().toISOString(),
            });
            this.logger.log(`[TXN] Generated RRN: ${rrn}, Hash: ${txHash}`);
            transaction = await this.prisma.$transaction(async (tx) => {
                const newTxn = await tx.transaction.create({
                    data: {
                        rrn,
                        senderId: request.senderId,
                        senderAccountId,
                        receiverId: receiver.id,
                        receiverAccountId,
                        amount: transferAmount,
                        currency: senderAccount.currency,
                        description: request.description,
                        transactionType: 'UPI_TRANSFER',
                        idempotencyKey,
                        txHash,
                        status: 'PROCESSING',
                        blockchainStatus: 'PENDING',
                    },
                });
                const updatedSenderAccount = await tx.account.update({
                    where: { id: senderAccountId },
                    data: {
                        currentBalance: {
                            decrement: transferAmount,
                        },
                        updatedAt: new Date(),
                    },
                });
                if (updatedSenderAccount.currentBalance.isNegative()) {
                    throw new Error('BALANCE_BECAME_NEGATIVE: Race condition detected in account update');
                }
                const updatedReceiverAccount = await tx.account.update({
                    where: { id: receiverAccountId },
                    data: {
                        currentBalance: {
                            increment: transferAmount,
                        },
                        updatedAt: new Date(),
                    },
                });
                return {
                    transaction: newTxn,
                    senderAccount: updatedSenderAccount,
                    receiverAccount: updatedReceiverAccount,
                };
            }, {
                isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,
                timeout: 15000,
            });
            this.logger.log(`[TXN-LEDGER] Transaction recorded: ${transaction.transaction.id}`);
            await this.prisma.transaction.update({
                where: { id: transaction.transaction.id },
                data: {
                    status: 'SETTLED',
                    settledAt: new Date(),
                },
            });
            this.submitBlockchainAnchor(transaction.transaction.id, txHash).catch((err) => {
                this.logger.error(`[BLOCKCHAIN-ANCHOR-ERROR] Failed to anchor transaction ${transaction.transaction.id}: ${err.message}`);
            });
            const response = {
                success: true,
                transactionId: transaction.transaction.id,
                rrn: rrn,
                txHash: txHash,
                blockchainStatus: 'PENDING',
                message: `Transfer of ${request.amount} MYSIM to ${request.receiverHandle} successful`,
                timestamp: new Date().toISOString(),
            };
            await this.cacheIdempotencyResponse(request.senderId, request.idempotencyKey, response);
            this.logger.log(`[TRANSFER-SUCCESS] ${rrn}`);
            return response;
        }
        catch (error) {
            this.logger.error(`[TRANSFER-ERROR] ${error.message}`, error.stack);
            const isRecoverable = this.isRecoverableError(error);
            if (transaction) {
                try {
                    await this.prisma.transaction.update({
                        where: { id: transaction.transaction.id },
                        data: {
                            status: 'ROLLED_BACK',
                            errorReason: error.message.substring(0, 500),
                        },
                    });
                }
                catch (rollbackErr) {
                    this.logger.error(`[ROLLBACK-ERROR] Could not mark transaction rolled back: ${rollbackErr.message}`);
                }
            }
            if (error instanceof common_1.BadRequestException) {
                throw error;
            }
            if (error instanceof common_1.ConflictException) {
                throw error;
            }
            throw new common_1.InternalServerErrorException(isRecoverable
                ? 'Transaction failed. Please retry.'
                : 'Transaction failed. Please contact support.');
        }
        finally {
            if (senderAccountId && receiverAccountId) {
                const lockKeys = this.sortLockKeys(senderAccountId, receiverAccountId);
                await this.releaseDistributedLocks(lockKeys).catch((err) => {
                    this.logger.warn(`[LOCK-RELEASE-ERROR] ${err.message}`);
                });
            }
        }
    }
    async checkIdempotency(userId, idempotencyKey) {
        const cacheKey = `idempotency:${userId}:${idempotencyKey}`;
        return this.redis.get(cacheKey);
    }
    async cacheIdempotencyResponse(userId, idempotencyKey, response) {
        const cacheKey = `idempotency:${userId}:${idempotencyKey}`;
        await this.redis.setex(cacheKey, this.IDEMPOTENCY_WINDOW_SEC, JSON.stringify(response));
    }
    sortLockKeys(key1, key2) {
        return [key1, key2].sort();
    }
    async acquireDistributedLocks(keys) {
        try {
            const locks = [];
            for (const key of keys) {
                const lockKey = `lock:${key}`;
                const lockValue = (0, uuid_1.v4)();
                const acquired = await this.redis.set(lockKey, lockValue, 'EX', 30, 'NX');
                if (!acquired) {
                    for (let i = 0; i < locks.length; i++) {
                        await this.redis.del(`lock:${keys[i]}`);
                    }
                    return null;
                }
                locks.push(lockValue);
            }
            return locks;
        }
        catch (error) {
            this.logger.error(`[LOCK-ACQUIRE-ERROR] ${error.message}`);
            return null;
        }
    }
    async releaseDistributedLocks(keys) {
        for (const key of keys) {
            await this.redis.del(`lock:${key}`);
        }
    }
    async getLockedBalance(accountId) {
        const account = await this.prisma.account.findUnique({
            where: { id: accountId },
        });
        if (!account) {
            throw new common_1.BadRequestException(`Account not found: ${accountId}`);
        }
        return account.currentBalance;
    }
    validateTransferRequest(request) {
        if (!request.senderId || request.senderId.trim().length === 0) {
            throw new common_1.BadRequestException('Invalid sender ID format');
        }
        if (!/^[a-zA-Z0-9._-]+@mybank$/.test(request.receiverHandle)) {
            throw new common_1.BadRequestException('Invalid receiver handle. Expected format: user@mybank');
        }
        const amount = parseFloat(request.amount.toString());
        if (isNaN(amount) || amount <= 0) {
            throw new common_1.BadRequestException('Amount must be a positive number');
        }
        const decimals = (amount.toString().split('.')[1] || '').length;
        if (decimals > 6) {
            throw new common_1.BadRequestException('Amount precision exceeds 6 decimal places');
        }
        if (!request.description || request.description.length > 500) {
            throw new common_1.BadRequestException('Description must be 1-500 characters');
        }
        if (!this.isValidUUID(request.idempotencyKey)) {
            throw new common_1.BadRequestException('Invalid idempotency key. Expected UUIDv4.');
        }
    }
    generateTransactionHash(params) {
        const preimage = `${params.senderId}${params.receiverId}${params.amount}${params.timestamp}`;
        const hash = crypto
            .createHash('sha256')
            .update(preimage)
            .digest('hex');
        return `0x${hash}`;
    }
    generateRRN() {
        const now = new Date();
        const year = now.getFullYear().toString();
        const dayOfYear = this.getDayOfYear(now)
            .toString()
            .padStart(3, '0');
        const randomHex = crypto.randomBytes(3).toString('hex').toUpperCase();
        return `${year}${dayOfYear}${randomHex}`;
    }
    getDayOfYear(date) {
        const start = new Date(date.getFullYear(), 0, 0);
        const diff = date.getTime() - start.getTime();
        const oneDay = 1000 * 60 * 60 * 24;
        return Math.floor(diff / oneDay);
    }
    async submitBlockchainAnchor(transactionId, txHash) {
        try {
            const result = await this.blockchain.anchorTransaction(transactionId, txHash);
            await this.prisma.blockchainAuditLog.create({
                data: {
                    transactionId,
                    txHash,
                    smartContractAddr: this.blockchain.getContractAddress(),
                    eventSignature: 'TransactionAnchored(bytes32)',
                    verificationStatus: 'PENDING',
                    anchoredAt: new Date(),
                },
            });
            this.logger.log(`[BLOCKCHAIN-ANCHOR-SUCCESS] Transaction ${transactionId} anchored with hash ${txHash}`);
        }
        catch (error) {
            this.logger.error(`[BLOCKCHAIN-ANCHOR-FAILED] Could not anchor transaction ${transactionId}: ${error.message}`);
        }
    }
    isValidUUID(uuid) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(uuid);
    }
    isRecoverableError(error) {
        const recoverableMessages = [
            'ECONNREFUSED',
            'ENOTFOUND',
            'ETIMEDOUT',
            'Could not acquire transaction locks',
        ];
        return recoverableMessages.some((msg) => error.message.includes(msg));
    }
};
exports.TransferService = TransferService;
exports.TransferService = TransferService = TransferService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        blockchain_service_1.BlockchainService])
], TransferService);
//# sourceMappingURL=transfer.service.js.map