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
var UpiPaymentService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpiPaymentService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const prisma_service_1 = require("./prisma.service");
const redis_service_1 = require("./redis.service");
const blockchain_service_1 = require("./blockchain.service");
const client_1 = require("@prisma/client");
const uuid_1 = require("uuid");
const library_1 = require("@prisma/client/runtime/library");
const crypto = __importStar(require("crypto"));
const IDEMPOTENCY_RESULT_TTL_SEC = 120;
const IDEMPOTENCY_INFLIGHT_TTL_SEC = 45;
const LOCK_TTL_SEC = 30;
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
const LOCK_RETRY_INTERVAL_MS = 200;
const MAX_TRANSFER_AMOUNT = 100_000;
const MIN_TRANSFER_AMOUNT = 0.01;
const MAX_DECIMAL_PLACES = 6;
class RequestInFlightException extends common_1.ConflictException {
    constructor(idempotencyKey) {
        super(`Request ${idempotencyKey} is already being processed. Retry in a moment.`);
    }
}
class InsufficientFundsException extends common_1.UnprocessableEntityException {
    constructor(available, requested) {
        super(`Insufficient balance. Available: ${available} MYSIM, Requested: ${requested} MYSIM.`);
    }
}
class BalanceIntegrityException extends common_1.InternalServerErrorException {
    constructor(accountId) {
        super(`Balance integrity check failed for account ${accountId}. Transaction rolled back.`);
    }
}
let UpiPaymentService = UpiPaymentService_1 = class UpiPaymentService {
    constructor(prisma, redis, blockchain, config) {
        this.prisma = prisma;
        this.redis = redis;
        this.blockchain = blockchain;
        this.config = config;
        this.logger = new common_1.Logger(UpiPaymentService_1.name);
    }
    async processUpiPayment(request) {
        const correlationId = (0, uuid_1.v4)();
        this.logger.log(`[UPI][${correlationId}] Initiating transfer ` +
            `${request.senderId} → ${request.receiverUpiHandle} | ` +
            `amount=${request.amount} | idem=${request.idempotencyKey}`);
        let senderAccountId = null;
        let receiverAccountId = null;
        let acquiredLocks = [];
        let pendingTransactionId = null;
        try {
            this.validateRequest(request);
            const cachedResult = await this.lookupIdempotencyResult(request.senderId, request.idempotencyKey);
            if (cachedResult !== null) {
                this.logger.log(`[UPI][${correlationId}][IDEMPOTENCY] Cache hit — returning stored result.`);
                return cachedResult;
            }
            const sentinelAcquired = await this.acquireIdempotencySentinel(request.senderId, request.idempotencyKey);
            if (!sentinelAcquired) {
                throw new RequestInFlightException(request.idempotencyKey);
            }
            const receiver = await this.resolveReceiverAccount(request.receiverUpiHandle, request.senderId);
            receiverAccountId = receiver.accountId;
            const senderAccountMeta = await this.resolveSenderAccount(request.senderId);
            senderAccountId = senderAccountMeta.id;
            const lockKeys = this.sortedLockKeys(senderAccountId, receiverAccountId);
            acquiredLocks = await this.acquireLocksWithTimeout(lockKeys, correlationId);
            const rrn = this.generateRrn();
            const txHash = this.generateTxHash({
                senderId: request.senderId,
                receiverId: receiver.userId,
                amount: String(request.amount),
                rrn,
                idempotencyKey: request.idempotencyKey,
                timestamp: new Date().toISOString(),
            });
            this.logger.log(`[UPI][${correlationId}] Identifiers — RRN=${rrn} | txHash=${txHash.slice(0, 18)}…`);
            const transferAmount = new library_1.Decimal(request.amount);
            const committedTransaction = await this.prisma.$transaction(async (tx) => {
                const [lockedSender, lockedReceiver] = await this.lockAccountRows(tx, senderAccountId, receiverAccountId);
                if (lockedSender.status !== 'ACTIVE') {
                    throw new common_1.BadRequestException(`Sender account is not active (status: ${lockedSender.status}).`);
                }
                if (lockedReceiver.status !== 'ACTIVE') {
                    throw new common_1.BadRequestException(`Receiver account is not active (status: ${lockedReceiver.status}).`);
                }
                const senderBalance = new library_1.Decimal(lockedSender.currentBalance);
                if (senderBalance.lessThan(transferAmount)) {
                    throw new InsufficientFundsException(senderBalance.toFixed(2), transferAmount.toFixed(2));
                }
                const txRecord = await tx.transaction.create({
                    data: {
                        rrn,
                        senderId: request.senderId,
                        senderAccountId: senderAccountId,
                        receiverId: receiver.userId,
                        receiverAccountId: receiverAccountId,
                        amount: transferAmount,
                        currency: lockedSender.currency,
                        description: request.description,
                        transactionType: 'UPI_TRANSFER',
                        idempotencyKey: request.idempotencyKey,
                        txHash,
                        status: 'PROCESSING',
                        blockchainStatus: 'PENDING',
                    },
                });
                pendingTransactionId = txRecord.id;
                const updatedSender = await tx.account.update({
                    where: { id: senderAccountId },
                    data: {
                        currentBalance: { decrement: transferAmount },
                        updatedAt: new Date(),
                    },
                });
                if (updatedSender.currentBalance.isNegative()) {
                    throw new BalanceIntegrityException(senderAccountId);
                }
                const updatedReceiver = await tx.account.update({
                    where: { id: receiverAccountId },
                    data: {
                        currentBalance: { increment: transferAmount },
                        updatedAt: new Date(),
                    },
                });
                const settledTx = await tx.transaction.update({
                    where: { id: txRecord.id },
                    data: {
                        status: 'SETTLED',
                        settledAt: new Date(),
                    },
                });
                return {
                    txRecord: settledTx,
                    updatedSender,
                    updatedReceiver,
                };
            }, {
                isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable,
                timeout: 15_000,
                maxWait: 5_000,
            });
            const { txRecord } = committedTransaction;
            this.logger.log(`[UPI][${correlationId}] DB committed — txId=${txRecord.id} | status=${txRecord.status}`);
            void this.anchorToBlockchainLedger(txRecord.id, txHash, correlationId);
            const result = {
                success: true,
                transactionId: txRecord.id,
                rrn,
                txHash,
                blockchainStatus: 'PENDING',
                message: `Successfully transferred ${request.amount} MYSIM to ${request.receiverUpiHandle}.`,
                timestamp: new Date().toISOString(),
            };
            await this.storeIdempotencyResult(request.senderId, request.idempotencyKey, result);
            this.logger.log(`[UPI][${correlationId}] ✅ Payment complete — RRN=${rrn}`);
            return result;
        }
        catch (error) {
            this.logger.error(`[UPI][${correlationId}] ❌ Payment failed: ${error.message}`, error.stack);
            if (pendingTransactionId) {
                await this.markTransactionRolledBack(pendingTransactionId, error.message, correlationId);
            }
            if (!(error instanceof RequestInFlightException)) {
                await this.clearIdempotencySentinel(request.senderId, request.idempotencyKey);
            }
            if (error instanceof common_1.BadRequestException ||
                error instanceof common_1.ConflictException ||
                error instanceof common_1.UnprocessableEntityException ||
                error instanceof InsufficientFundsException ||
                error instanceof RequestInFlightException) {
                throw error;
            }
            throw this.classifyAndWrapError(error);
        }
        finally {
            if (acquiredLocks.length > 0) {
                await this.releaseAllLocks(acquiredLocks, correlationId);
            }
        }
    }
    idempotencyResultKey(userId, idemKey) {
        return `idem:result:${userId}:${idemKey}`;
    }
    idempotencySentinelKey(userId, idemKey) {
        return `idem:inflight:${userId}:${idemKey}`;
    }
    async lookupIdempotencyResult(userId, idemKey) {
        const raw = await this.redis.get(this.idempotencyResultKey(userId, idemKey));
        if (!raw)
            return null;
        try {
            return JSON.parse(raw);
        }
        catch {
            this.logger.warn(`[IDEMPOTENCY] Corrupted cache entry for key ${idemKey}; ignoring.`);
            return null;
        }
    }
    async acquireIdempotencySentinel(userId, idemKey) {
        const sentinel = {
            status: 'processing',
            startedAt: new Date().toISOString(),
        };
        return this.redis.set(this.idempotencySentinelKey(userId, idemKey), JSON.stringify(sentinel), 'EX', IDEMPOTENCY_INFLIGHT_TTL_SEC, 'NX');
    }
    async storeIdempotencyResult(userId, idemKey, result) {
        await this.redis.setex(this.idempotencyResultKey(userId, idemKey), IDEMPOTENCY_RESULT_TTL_SEC, JSON.stringify(result));
        await this.redis
            .del(this.idempotencySentinelKey(userId, idemKey))
            .catch(() => {
        });
    }
    async clearIdempotencySentinel(userId, idemKey) {
        await this.redis
            .del(this.idempotencySentinelKey(userId, idemKey))
            .catch(() => {
        });
    }
    sortedLockKeys(accountIdA, accountIdB) {
        return [accountIdA, accountIdB].sort();
    }
    async acquireLocksWithTimeout(keys, correlationId) {
        const acquired = [];
        const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
        for (const key of keys) {
            const lockKey = `lock:account:${key}`;
            let gotLock = false;
            while (Date.now() < deadline) {
                const ok = await this.redis.set(lockKey, correlationId, 'EX', LOCK_TTL_SEC, 'NX');
                if (ok) {
                    acquired.push(lockKey);
                    gotLock = true;
                    this.logger.debug(`[LOCK][${correlationId}] Acquired ${lockKey}`);
                    break;
                }
                await this.sleep(LOCK_RETRY_INTERVAL_MS);
            }
            if (!gotLock) {
                await this.releaseAllLocks(acquired, correlationId);
                throw new common_1.ConflictException('The account is busy with another transaction. Please retry in a moment.');
            }
        }
        return acquired;
    }
    async releaseAllLocks(lockKeys, correlationId) {
        for (const lockKey of lockKeys) {
            try {
                await this.redis.del(lockKey);
                this.logger.debug(`[LOCK][${correlationId}] Released ${lockKey}`);
            }
            catch (err) {
                this.logger.warn(`[LOCK][${correlationId}] Failed to release ${lockKey}: ${err.message}`);
            }
        }
    }
    async lockAccountRows(tx, senderAccountId, receiverAccountId) {
        const rows = await tx.$queryRaw `
      SELECT
        id,
        "userId",
        "currentBalance"::TEXT  AS "currentBalance",
        currency,
        status
      FROM "Account"
      WHERE id IN (${senderAccountId}, ${receiverAccountId})
      FOR UPDATE
    `;
        if (rows.length !== 2) {
            throw new common_1.BadRequestException('One or both accounts could not be found for locking.');
        }
        const sender = rows.find((r) => r.id === senderAccountId);
        const receiver = rows.find((r) => r.id === receiverAccountId);
        if (!sender || !receiver) {
            throw new common_1.BadRequestException('Failed to identify sender or receiver account in locked result set.');
        }
        return [sender, receiver];
    }
    async resolveSenderAccount(senderId) {
        const account = await this.prisma.account.findFirst({
            where: { userId: senderId, status: 'ACTIVE' },
            select: { id: true, currency: true },
        });
        if (!account) {
            throw new common_1.BadRequestException(`No active account found for sender ${senderId}.`);
        }
        return account;
    }
    async resolveReceiverAccount(upiHandle, senderId) {
        const user = await this.prisma.user.findUnique({
            where: { upiHandle },
            include: {
                accounts: {
                    where: { status: 'ACTIVE' },
                    select: { id: true },
                    take: 1,
                },
            },
        });
        if (!user) {
            throw new common_1.BadRequestException(`UPI handle not found: ${upiHandle}`);
        }
        if (user.id === senderId) {
            throw new common_1.BadRequestException('Self-transfers are not permitted.');
        }
        if (!user.accounts.length) {
            throw new common_1.BadRequestException(`Receiver ${upiHandle} has no active account to receive funds.`);
        }
        return { accountId: user.accounts[0].id, userId: user.id };
    }
    async anchorToBlockchainLedger(transactionId, txHash, correlationId) {
        this.logger.log(`[BLOCKCHAIN][${correlationId}] Anchoring txId=${transactionId} hash=${txHash.slice(0, 18)}…`);
        try {
            const anchorResult = await this.mockBlockchainAnchor(transactionId, txHash);
            await this.prisma.blockchainAuditLog.create({
                data: {
                    transactionId,
                    txHash,
                    smartContractAddr: this.blockchain.getContractAddress(),
                    eventSignature: 'TransactionAnchored(bytes32,uint256,uint256)',
                    verificationStatus: 'PENDING',
                    blockNumber: anchorResult.blockNumber
                        ? BigInt(anchorResult.blockNumber)
                        : null,
                    anchoredAt: new Date(),
                },
            });
            await this.prisma.transaction.update({
                where: { id: transactionId },
                data: {
                    blockchainStatus: 'ANCHORED',
                    blockchainTxId: anchorResult.onChainTxId,
                    blockedAt: new Date(),
                },
            });
            this.logger.log(`[BLOCKCHAIN][${correlationId}] ✅ Anchored — block=${anchorResult.blockNumber} | onChainTxId=${anchorResult.onChainTxId}`);
        }
        catch (err) {
            this.logger.error(`[BLOCKCHAIN][${correlationId}] ❌ Anchor failed: ${err.message}`, err.stack);
            await this.prisma.transaction
                .update({
                where: { id: transactionId },
                data: { blockchainStatus: 'FAILED' },
            })
                .catch((updateErr) => {
                this.logger.error(`[BLOCKCHAIN][${correlationId}] Could not mark blockchainStatus=FAILED: ${updateErr.message}`);
            });
            await this.enqueueBlockchainRetry(transactionId, txHash, correlationId);
        }
    }
    async mockBlockchainAnchor(transactionId, txHash) {
        await this.sleep(50 + Math.random() * 150);
        const isMockEnabled = this.config.get('MOCK_BLOCKCHAIN', 'false') === 'true' ||
            this.config.get('NODE_ENV') !== 'production';
        if (!isMockEnabled) {
            const result = await this.blockchain.anchorTransaction(transactionId, txHash);
            return {
                blockNumber: result.blockNumber,
                onChainTxId: result.txId,
            };
        }
        const mockBlockNumber = 19_000_000 +
            (parseInt(txHash.slice(2, 10), 16) % 999_999);
        const mockOnChainTxId = '0x' +
            crypto
                .createHash('sha256')
                .update(`${transactionId}:${txHash}:${mockBlockNumber}`)
                .digest('hex');
        this.logger.debug(`[BLOCKCHAIN-MOCK] Simulated anchor — block=${mockBlockNumber} | onChainTx=${mockOnChainTxId.slice(0, 18)}…`);
        return {
            blockNumber: mockBlockNumber,
            onChainTxId: mockOnChainTxId,
        };
    }
    async enqueueBlockchainRetry(transactionId, txHash, correlationId) {
        try {
            await this.prisma.asyncJob.create({
                data: {
                    jobType: 'SETTLEMENT_BATCH',
                    gatewayId: this.config.get('BLOCKCHAIN_GATEWAY_ID', 'blockchain-default'),
                    transactionId,
                    referenceId: `bc-retry:${transactionId}:${Date.now()}`,
                    payload: JSON.stringify({ transactionId, txHash, correlationId }),
                    status: 'PENDING',
                    maxRetries: 5,
                    nextRetryAt: new Date(Date.now() + 60_000),
                },
            });
            this.logger.log(`[BLOCKCHAIN][${correlationId}] Retry job enqueued for txId=${transactionId}`);
        }
        catch (err) {
            this.logger.error(`[BLOCKCHAIN][${correlationId}] Could not enqueue retry job: ${err.message}`);
        }
    }
    async markTransactionRolledBack(transactionId, reason, correlationId) {
        try {
            await this.prisma.transaction.update({
                where: { id: transactionId },
                data: {
                    status: 'ROLLED_BACK',
                    errorReason: reason.substring(0, 500),
                },
            });
            this.logger.warn(`[ROLLBACK][${correlationId}] Marked txId=${transactionId} as ROLLED_BACK.`);
        }
        catch (err) {
            this.logger.error(`[ROLLBACK][${correlationId}] ⚠️  Could not mark transaction ROLLED_BACK: ${err.message}. ` +
                `Manual reconciliation required for txId=${transactionId}.`);
        }
    }
    classifyAndWrapError(error) {
        const retryablePatterns = [
            'ECONNREFUSED',
            'ENOTFOUND',
            'ETIMEDOUT',
            'connect ETIMEDOUT',
            'Too many connections',
            'deadlock detected',
            'P2034',
        ];
        const isRetryable = retryablePatterns.some((pattern) => error.message.includes(pattern));
        return new common_1.InternalServerErrorException(isRetryable
            ? 'A temporary infrastructure error occurred. Please retry your request.'
            : 'Payment processing failed. Please contact support if the issue persists.');
    }
    validateRequest(request) {
        if (!this.isValidUuidV4(request.senderId)) {
            throw new common_1.BadRequestException('Invalid senderId — expected UUIDv4.');
        }
        if (!this.isValidUuidV4(request.idempotencyKey)) {
            throw new common_1.BadRequestException('Invalid X-Idempotency-Key — expected UUIDv4.');
        }
        const upiPattern = /^[a-zA-Z0-9._-]{3,50}@mybank$/;
        if (!upiPattern.test(request.receiverUpiHandle)) {
            throw new common_1.BadRequestException('Invalid receiver UPI handle. Expected format: username@mybank (3-50 alphanumeric chars).');
        }
        const amount = Number(request.amount);
        if (!Number.isFinite(amount) || amount < MIN_TRANSFER_AMOUNT) {
            throw new common_1.BadRequestException(`Amount must be a positive number ≥ ${MIN_TRANSFER_AMOUNT}.`);
        }
        if (amount > MAX_TRANSFER_AMOUNT) {
            throw new common_1.BadRequestException(`Amount exceeds the per-transaction ceiling of ${MAX_TRANSFER_AMOUNT} MYSIM.`);
        }
        const decimalPart = (amount.toString().split('.')[1] ?? '').length;
        if (decimalPart > MAX_DECIMAL_PLACES) {
            throw new common_1.BadRequestException(`Amount must have at most ${MAX_DECIMAL_PLACES} decimal places.`);
        }
        if (!request.description?.trim()) {
            throw new common_1.BadRequestException('Description is required.');
        }
        if (request.description.length > 500) {
            throw new common_1.BadRequestException('Description must not exceed 500 characters.');
        }
    }
    generateRrn() {
        const now = new Date();
        const year = now.getFullYear().toString();
        const start = new Date(now.getFullYear(), 0, 0);
        const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
            .toString()
            .padStart(3, '0');
        const random = crypto.randomBytes(3).toString('hex').toUpperCase();
        return `${year}${dayOfYear}${random}`;
    }
    generateTxHash(params) {
        const preimage = [
            params.senderId,
            params.receiverId,
            params.amount,
            params.rrn,
            params.idempotencyKey,
            params.timestamp,
        ].join(':');
        return ('0x' + crypto.createHash('sha256').update(preimage).digest('hex'));
    }
    isValidUuidV4(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
};
exports.UpiPaymentService = UpiPaymentService;
exports.UpiPaymentService = UpiPaymentService = UpiPaymentService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        blockchain_service_1.BlockchainService,
        config_1.ConfigService])
], UpiPaymentService);
//# sourceMappingURL=upi-payment.service.js.map