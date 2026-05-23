"use strict";
// Core Banking Platform - Async Job Worker
// Background task processor for third-party gateway integrations
// Handles mobile recharge, utility payments, and settlement batches
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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AsyncJobWorkerService = exports.ThirdPartyOperator = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("./prisma.service");
const redis_service_1 = require("./redis.service");
const config_1 = require("@nestjs/config");
const crypto = __importStar(require("crypto"));
// ============================================================================
// TYPES & INTERFACES
// ============================================================================
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
// ============================================================================
// ASYNC JOB WORKER SERVICE
// ============================================================================
let AsyncJobWorkerService = AsyncJobWorkerService_1 = class AsyncJobWorkerService {
    constructor(prisma, redis, config) {
        this.prisma = prisma;
        this.redis = redis;
        this.config = config;
        this.logger = new common_1.Logger(AsyncJobWorkerService_1.name);
        this.WORKER_POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
        this.MAX_CONCURRENT_JOBS = 10;
        this.JOB_PROCESSING_TIMEOUT_MS = 60000; // 60 second timeout per job
        this.isRunning = false;
        this.workerTimer = null;
        // Mock operator gateways (in production, replace with real API calls)
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
    /**
     * Start the async job worker on module initialization
     */
    async onModuleInit() {
        this.logger.log('[WORKER-INIT] Starting async job worker');
        await this.startWorker();
    }
    /**
     * Stop the worker on module destruction (graceful shutdown)
     */
    async onModuleDestroy() {
        this.logger.log('[WORKER-SHUTDOWN] Stopping async job worker');
        await this.stopWorker();
    }
    /**
     * Start the worker loop
     * Continuously polls for pending jobs and processes them
     */
    async startWorker() {
        if (this.isRunning) {
            this.logger.warn('[WORKER] Already running');
            return;
        }
        this.isRunning = true;
        this.logger.log('[WORKER-STARTED] Job processor running');
        // Start polling for jobs
        this.workerTimer = setInterval(() => {
            this.processPendingJobs().catch((err) => {
                this.logger.error(`[WORKER-LOOP-ERROR] ${err.message}`);
            });
        }, this.WORKER_POLL_INTERVAL_MS);
    }
    /**
     * Stop the worker loop
     */
    async stopWorker() {
        this.isRunning = false;
        if (this.workerTimer) {
            clearInterval(this.workerTimer);
            this.workerTimer = null;
        }
        this.logger.log('[WORKER-STOPPED]');
    }
    // =========================================================================
    // CORE WORKER LOOP: PROCESS PENDING JOBS
    // =========================================================================
    /**
     * Poll database for pending jobs and process them
     * Implements fair scheduling and concurrency control
     */
    async processPendingJobs() {
        try {
            // Fetch up to MAX_CONCURRENT_JOBS pending jobs
            const pendingJobs = await this.prisma.asyncJob.findMany({
                where: {
                    status: 'PENDING',
                    nextRetryAt: {
                        lte: new Date(), // Only jobs that are ready for retry
                    },
                },
                include: {
                    gateway: true,
                },
                take: this.MAX_CONCURRENT_JOBS,
                orderBy: { createdAt: 'asc' }, // FIFO order
            });
            if (pendingJobs.length === 0) {
                return; // No jobs to process
            }
            this.logger.log(`[WORKER-PROCESS] Found ${pendingJobs.length} pending jobs`);
            // Process jobs concurrently (up to MAX_CONCURRENT_JOBS)
            const promises = pendingJobs.map((job) => this.processJob(job).catch((err) => {
                this.logger.error(`[JOB-PROCESSING-ERROR] Job ${job.id}: ${err.message}`);
            }));
            await Promise.allSettled(promises);
        }
        catch (error) {
            this.logger.error(`[WORKER-POLL-ERROR] ${error.message}`);
        }
    }
    /**
     * Process a single async job
     * Handles retries, error tracking, and state transitions
     */
    async processJob(job) {
        const jobId = job.id;
        const startTime = Date.now();
        this.logger.log(`[JOB-START] ${jobId}, Type: ${job.jobType}`);
        try {
            // =====================================================================
            // STEP 1: ACQUIRE LOCK TO PREVENT DUPLICATE PROCESSING
            // =====================================================================
            const lockKey = `job:${jobId}`;
            const lockAcquired = await this.redis.set(lockKey, jobId, 'EX', 60, // 60 second lock
            'NX');
            if (!lockAcquired) {
                this.logger.warn(`[JOB-LOCKED] ${jobId} already being processed`);
                return;
            }
            // =====================================================================
            // STEP 2: MARK JOB AS PROCESSING
            // =====================================================================
            await this.prisma.asyncJob.update({
                where: { id: jobId },
                data: {
                    status: 'PROCESSING',
                },
            });
            // =====================================================================
            // STEP 3: ROUTE TO APPROPRIATE HANDLER
            // =====================================================================
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
            // =====================================================================
            // STEP 4: HANDLE SUCCESS
            // =====================================================================
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
                // Emit success event (for WebSocket notifications)
                await this.emitJobStatusEvent(job.transactionId, 'SUCCESS', result);
            }
            else {
                throw new Error(`Gateway rejected request: ${result.message}`);
            }
        }
        catch (error) {
            // =====================================================================
            // STEP 5: HANDLE FAILURE WITH RETRY LOGIC
            // =====================================================================
            const attempts = job.attempts + 1;
            const isRecoverable = this.isRecoverableError(error);
            if (attempts < job.maxRetries && isRecoverable) {
                // Calculate exponential backoff: 2^attempt * 1000ms, capped at 5 minutes
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
                // Mark as dead letter (permanent failure)
                await this.prisma.asyncJob.update({
                    where: { id: jobId },
                    data: {
                        status: 'DEAD_LETTER',
                        errorMessage: error.message.substring(0, 500),
                        attempts,
                    },
                });
                this.logger.error(`[JOB-DEAD-LETTER] ${jobId}, Attempts exhausted`);
                // Emit failure event
                await this.emitJobStatusEvent(job.transactionId, 'FAILED', { error: error.message });
            }
        }
        finally {
            // =====================================================================
            // CLEANUP: RELEASE LOCK
            // =====================================================================
            const lockKey = `job:${jobId}`;
            await this.redis.del(lockKey).catch((err) => {
                this.logger.warn(`[LOCK-RELEASE-ERROR] ${err.message}`);
            });
        }
    }
    // =========================================================================
    // JOB HANDLERS: BUSINESS LOGIC FOR EACH OPERATOR
    // =========================================================================
    /**
     * Handle mobile recharge job
     * Communicates with mobile operator API
     */
    async handleMobileRecharge(job) {
        try {
            const payload = JSON.parse(job.payload);
            this.logger.log(`[RECHARGE] Phone: ${payload.phoneNumber}, Amount: ${payload.amount}, Operator: ${payload.operatorCode}`);
            // In production, call actual operator API
            // For simulation, generate mock response
            const operatorRefId = this.generateOperatorRefId(payload.phoneNumber, payload.operatorCode);
            // Simulate network delay (500ms - 2s)
            await this.delay(500 + Math.random() * 1500);
            // Simulate 95% success rate
            if (Math.random() < 0.95) {
                return {
                    success: true,
                    operatorRefId,
                    message: `Recharge successful for ${payload.phoneNumber}`,
                    additionalData: {
                        balance: (payload.amount * 0.8).toFixed(2), // Mock balance after recharge
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
    /**
     * Handle utility bill payment job
     * Communicates with utility provider API
     */
    async handleUtilityPayment(job) {
        try {
            const payload = JSON.parse(job.payload);
            this.logger.log(`[UTILITY-PAYMENT] Consumer: ${payload.consumerNumber}, Amount: ${payload.amount}, Type: ${payload.utilityType}`);
            // Generate operator reference ID
            const operatorRefId = this.generateOperatorRefId(payload.consumerNumber, payload.utilityType);
            // Simulate network delay (800ms - 3s)
            await this.delay(800 + Math.random() * 2200);
            // Simulate 92% success rate (utilities slightly less reliable)
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
    /**
     * Handle settlement batch job
     * Aggregates daily transactions and submits to clearing house
     */
    async handleSettlementBatch(job) {
        try {
            this.logger.log(`[SETTLEMENT-BATCH] Processing batch ${job.id}`);
            // Simulate settlement processing
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
    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================
    /**
     * Generate operator reference ID (unique across operator)
     * Format: OPERATOR-TIMESTAMP-RANDOM
     */
    generateOperatorRefId(identifier, operator) {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = crypto.randomBytes(4).toString('hex').toUpperCase();
        return `${operator}-${timestamp}-${random}`;
    }
    /**
     * Generate batch reference ID for settlement
     */
    generateBatchRefId() {
        const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const batchNum = crypto.randomBytes(3).toString('hex').toUpperCase();
        return `BATCH-${date}-${batchNum}`;
    }
    /**
     * Check if error is recoverable (retry-worthy)
     */
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
    /**
     * Get next batch settlement time (typically 6 AM next day)
     */
    getNextBatchTime() {
        const next = new Date();
        next.setDate(next.getDate() + 1);
        next.setHours(6, 0, 0, 0);
        return next;
    }
    /**
     * Emit job status event via WebSocket
     */
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
    /**
     * Utility: Sleep for milliseconds
     */
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    // =========================================================================
    // PUBLIC API: CREATE NEW JOB
    // =========================================================================
    /**
     * Create a new async job
     * Returns job ID for status tracking
     */
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
    /**
     * Select appropriate gateway based on job type
     */
    async selectGatewayId(jobType) {
        // In production, implement load-balancing and failover logic
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
    __metadata("design:paramtypes", [typeof (_a = typeof prisma_service_1.PrismaService !== "undefined" && prisma_service_1.PrismaService) === "function" ? _a : Object, redis_service_1.RedisService,
        config_1.ConfigService])
], AsyncJobWorkerService);
