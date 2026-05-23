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
var AsyncJobWorkerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncJobWorkerService = exports.ThirdPartyOperator = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("./prisma.service");
const redis_service_1 = require("./redis.service");
const config_1 = require("@nestjs/config");
const crypto = __importStar(require("crypto"));
var ThirdPartyOperator;
(function (ThirdPartyOperator) {
    ThirdPartyOperator["JIO"] = "JIO";
    ThirdPartyOperator["AIRTEL"] = "AIRTEL";
    ThirdPartyOperator["BSNL"] = "BSNL";
    ThirdPartyOperator["VI"] = "VODAFONE_IDEA";
    ThirdPartyOperator["ELECTRICITY"] = "STATE_ELECTRICITY_BOARD";
    ThirdPartyOperator["WATER"] = "MUNICIPAL_WATER";
    ThirdPartyOperator["GAS"] = "STATE_GAS_CORPORATION";
})(ThirdPartyOperator || (exports.ThirdPartyOperator = ThirdPartyOperator = {}));
let AsyncJobWorkerService = AsyncJobWorkerService_1 = class AsyncJobWorkerService {
    constructor(prisma, redis, config) {
        this.prisma = prisma;
        this.redis = redis;
        this.config = config;
        this.logger = new common_1.Logger(AsyncJobWorkerService_1.name);
        this.WORKER_POLL_INTERVAL_MS = 5000;
        this.MAX_CONCURRENT_JOBS = 10;
        this.JOB_PROCESSING_TIMEOUT_MS = 60000;
        this.isRunning = false;
        this.workerTimer = null;
        this.gatewayConfig = {
            [ThirdPartyOperator.JIO]: {
                endpoint: 'https://api.jio.com/v1/recharge',
                timeout: 10000,
            },
            [ThirdPartyOperator.AIRTEL]: {
                endpoint: 'https://api.airtel.com/v2/recharge',
                timeout: 10000,
            },
            [ThirdPartyOperator.BSNL]: {
                endpoint: 'https://api.bsnl.co.in/v1/recharge',
                timeout: 15000,
            },
            [ThirdPartyOperator.ELECTRICITY]: {
                endpoint: 'https://api.stateelectricity.gov.in/payment',
                timeout: 20000,
            },
        };
    }
    async onModuleInit() {
        this.logger.log('[WORKER-INIT] Starting async job worker');
        await this.startWorker();
    }
    async onModuleDestroy() {
        this.logger.log('[WORKER-SHUTDOWN] Stopping async job worker');
        await this.stopWorker();
    }
    async startWorker() {
        if (this.isRunning) {
            this.logger.warn('[WORKER] Already running');
            return;
        }
        this.isRunning = true;
        this.logger.log('[WORKER-STARTED] Job processor running');
        this.workerTimer = setInterval(() => {
            this.processPendingJobs().catch((err) => {
                this.logger.error(`[WORKER-LOOP-ERROR] ${err.message}`);
            });
        }, this.WORKER_POLL_INTERVAL_MS);
    }
    async stopWorker() {
        this.isRunning = false;
        if (this.workerTimer) {
            clearInterval(this.workerTimer);
            this.workerTimer = null;
        }
        this.logger.log('[WORKER-STOPPED]');
    }
    async processPendingJobs() {
        try {
            const pendingJobs = await this.prisma.asyncJob.findMany({
                where: {
                    status: 'PENDING',
                    nextRetryAt: {
                        lte: new Date(),
                    },
                },
                include: {
                    gateway: true,
                },
                take: this.MAX_CONCURRENT_JOBS,
                orderBy: { createdAt: 'asc' },
            });
            if (pendingJobs.length === 0) {
                return;
            }
            this.logger.log(`[WORKER-PROCESS] Found ${pendingJobs.length} pending jobs`);
            const promises = pendingJobs.map((job) => this.processJob(job).catch((err) => {
                this.logger.error(`[JOB-PROCESSING-ERROR] Job ${job.id}: ${err.message}`);
            }));
            await Promise.allSettled(promises);
        }
        catch (error) {
            this.logger.error(`[WORKER-POLL-ERROR] ${error.message}`);
        }
    }
    async processJob(job) {
        const jobId = job.id;
        const startTime = Date.now();
        this.logger.log(`[JOB-START] ${jobId}, Type: ${job.jobType}`);
        try {
            const lockKey = `job:${jobId}`;
            const lockAcquired = await this.redis.set(lockKey, jobId, 'EX', 60, 'NX');
            if (!lockAcquired) {
                this.logger.warn(`[JOB-LOCKED] ${jobId} already being processed`);
                return;
            }
            await this.prisma.asyncJob.update({
                where: { id: jobId },
                data: {
                    status: 'PROCESSING',
                },
            });
            let result;
            switch (job.jobType) {
                case 'MOBILE_RECHARGE':
                    result = await this.handleMobileRecharge(job);
                    break;
                case 'UTILITY_PAYMENT':
                    result = await this.handleUtilityPayment(job);
                    break;
                case 'SETTLEMENT_BATCH':
                    result = await this.handleSettlementBatch(job);
                    break;
                default:
                    throw new Error(`Unknown job type: ${job.jobType}`);
            }
            if (result.success) {
                await this.prisma.asyncJob.update({
                    where: { id: jobId },
                    data: {
                        status: 'COMPLETED',
                        responseData: JSON.stringify(result),
                        referenceId: result.operatorRefId,
                        processedAt: new Date(),
                        attempts: job.attempts + 1,
                    },
                });
                this.logger.log(`[JOB-SUCCESS] ${jobId}, OpRefId: ${result.operatorRefId}, Duration: ${Date.now() - startTime}ms`);
                await this.emitJobStatusEvent(job.transactionId, 'SUCCESS', result);
            }
            else {
                throw new Error(`Gateway rejected request: ${result.message}`);
            }
        }
        catch (error) {
            const attempts = job.attempts + 1;
            const isRecoverable = this.isRecoverableError(error);
            if (attempts < job.maxRetries && isRecoverable) {
                const backoffMs = Math.min(Math.pow(2, attempts) * 1000, 5 * 60 * 1000);
                const nextRetryAt = new Date(Date.now() + backoffMs);
                await this.prisma.asyncJob.update({
                    where: { id: jobId },
                    data: {
                        status: 'RETRYING',
                        errorMessage: error.message.substring(0, 500),
                        attempts,
                        nextRetryAt,
                    },
                });
                this.logger.warn(`[JOB-RETRY] ${jobId}, Attempt: ${attempts}/${job.maxRetries}, NextRetry: ${nextRetryAt.toISOString()}`);
            }
            else {
                await this.prisma.asyncJob.update({
                    where: { id: jobId },
                    data: {
                        status: 'DEAD_LETTER',
                        errorMessage: error.message.substring(0, 500),
                        attempts,
                    },
                });
                this.logger.error(`[JOB-DEAD-LETTER] ${jobId}, Attempts exhausted`);
                await this.emitJobStatusEvent(job.transactionId, 'FAILED', { error: error.message });
            }
        }
        finally {
            const lockKey = `job:${jobId}`;
            await this.redis.del(lockKey).catch((err) => {
                this.logger.warn(`[LOCK-RELEASE-ERROR] ${err.message}`);
            });
        }
    }
    async handleMobileRecharge(job) {
        try {
            const payload = JSON.parse(job.payload);
            this.logger.log(`[RECHARGE] Phone: ${payload.phoneNumber}, Amount: ${payload.amount}, Operator: ${payload.operatorCode}`);
            const operatorRefId = this.generateOperatorRefId(payload.phoneNumber, payload.operatorCode);
            await this.delay(500 + Math.random() * 1500);
            if (Math.random() < 0.95) {
                return {
                    success: true,
                    operatorRefId,
                    message: `Recharge successful for ${payload.phoneNumber}`,
                    additionalData: {
                        balance: (payload.amount * 0.8).toFixed(2),
                        validityDays: 28,
                    },
                };
            }
            else {
                throw new Error('GATEWAY_TIMEOUT: Operator did not respond in time');
            }
        }
        catch (error) {
            this.logger.error(`[RECHARGE-ERROR] ${error.message}`);
            throw error;
        }
    }
    async handleUtilityPayment(job) {
        try {
            const payload = JSON.parse(job.payload);
            this.logger.log(`[UTILITY-PAYMENT] Consumer: ${payload.consumerNumber}, Amount: ${payload.amount}, Type: ${payload.utilityType}`);
            const operatorRefId = this.generateOperatorRefId(payload.consumerNumber, payload.utilityType);
            await this.delay(800 + Math.random() * 2200);
            if (Math.random() < 0.92) {
                return {
                    success: true,
                    operatorRefId,
                    message: `Payment received for ${payload.consumerNumber}`,
                    additionalData: {
                        billMonth: payload.billMonth,
                        amountPaid: payload.amount.toString(),
                        receiptId: crypto.randomBytes(8).toString('hex'),
                    },
                };
            }
            else {
                throw new Error('UTILITY_PROVIDER_ERROR: Payment server temporarily unavailable');
            }
        }
        catch (error) {
            this.logger.error(`[UTILITY-PAYMENT-ERROR] ${error.message}`);
            throw error;
        }
    }
    async handleSettlementBatch(job) {
        try {
            this.logger.log(`[SETTLEMENT-BATCH] Processing batch ${job.id}`);
            await this.delay(2000 + Math.random() * 3000);
            const batchRefId = this.generateBatchRefId();
            return {
                success: true,
                operatorRefId: batchRefId,
                message: 'Settlement batch accepted',
                additionalData: {
                    batchId: batchRefId,
                    settledAt: new Date().toISOString(),
                    nextBatch: this.getNextBatchTime().toISOString(),
                },
            };
        }
        catch (error) {
            this.logger.error(`[SETTLEMENT-BATCH-ERROR] ${error.message}`);
            throw error;
        }
    }
    generateOperatorRefId(identifier, operator) {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = crypto.randomBytes(4).toString('hex').toUpperCase();
        return `${operator}-${timestamp}-${random}`;
    }
    generateBatchRefId() {
        const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const batchNum = crypto.randomBytes(3).toString('hex').toUpperCase();
        return `BATCH-${date}-${batchNum}`;
    }
    isRecoverableError(error) {
        const recoverableMessages = [
            'TIMEOUT',
            'GATEWAY_TIMEOUT',
            'TEMPORARY_UNAVAILABLE',
            'ECONNREFUSED',
            'ENOTFOUND',
            'ETIMEDOUT',
        ];
        return recoverableMessages.some((msg) => error.message.includes(msg));
    }
    getNextBatchTime() {
        const next = new Date();
        next.setDate(next.getDate() + 1);
        next.setHours(6, 0, 0, 0);
        return next;
    }
    async emitJobStatusEvent(transactionId, status, data) {
        if (!transactionId)
            return;
        try {
            const event = {
                type: 'JOB_STATUS_UPDATE',
                transactionId,
                status,
                data,
                timestamp: new Date().toISOString(),
            };
            await this.redis.rpush(`events:${transactionId}`, JSON.stringify(event));
        }
        catch (error) {
            this.logger.warn(`[EVENT-EMIT-ERROR] ${error.message}`);
        }
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async createJob(jobType, payload, transactionId) {
        const job = await this.prisma.asyncJob.create({
            data: {
                jobType: jobType,
                payload: JSON.stringify(payload),
                transactionId,
                gatewayId: await this.selectGatewayId(jobType),
                status: 'PENDING',
                attempts: 0,
                maxRetries: 3,
                referenceId: `REF-${Date.now()}`,
            },
        });
        this.logger.log(`[JOB-CREATED] ${job.id}, Type: ${jobType}`);
        return job.id;
    }
    async selectGatewayId(jobType) {
        const gateway = await this.prisma.thirdPartyGateway.findFirst({
            where: { status: 'ACTIVE' },
        });
        if (!gateway) {
            throw new Error('No active gateway available');
        }
        return gateway.id;
    }
};
exports.AsyncJobWorkerService = AsyncJobWorkerService;
exports.AsyncJobWorkerService = AsyncJobWorkerService = AsyncJobWorkerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        redis_service_1.RedisService,
        config_1.ConfigService])
], AsyncJobWorkerService);
//# sourceMappingURL=async-job-worker.service.js.map