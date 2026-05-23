import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { ConfigService } from '@nestjs/config';
export declare enum ThirdPartyOperator {
    JIO = "JIO",
    AIRTEL = "AIRTEL",
    BSNL = "BSNL",
    VI = "VODAFONE_IDEA",
    ELECTRICITY = "STATE_ELECTRICITY_BOARD",
    WATER = "MUNICIPAL_WATER",
    GAS = "STATE_GAS_CORPORATION"
}
export declare class AsyncJobWorkerService implements OnModuleInit, OnModuleDestroy {
    private prisma;
    private redis;
    private config;
    private readonly logger;
    private readonly WORKER_POLL_INTERVAL_MS;
    private readonly MAX_CONCURRENT_JOBS;
    private readonly JOB_PROCESSING_TIMEOUT_MS;
    private isRunning;
    private workerTimer;
    private readonly gatewayConfig;
    constructor(prisma: PrismaService, redis: RedisService, config: ConfigService);
    /**
     * Start the async job worker on module initialization
     */
    onModuleInit(): Promise<void>;
    /**
     * Stop the worker on module destruction (graceful shutdown)
     */
    onModuleDestroy(): Promise<void>;
    /**
     * Start the worker loop
     * Continuously polls for pending jobs and processes them
     */
    private startWorker;
    /**
     * Stop the worker loop
     */
    private stopWorker;
    /**
     * Poll database for pending jobs and process them
     * Implements fair scheduling and concurrency control
     */
    private processPendingJobs;
    /**
     * Process a single async job
     * Handles retries, error tracking, and state transitions
     */
    private processJob;
    /**
     * Handle mobile recharge job
     * Communicates with mobile operator API
     */
    private handleMobileRecharge;
    /**
     * Handle utility bill payment job
     * Communicates with utility provider API
     */
    private handleUtilityPayment;
    /**
     * Handle settlement batch job
     * Aggregates daily transactions and submits to clearing house
     */
    private handleSettlementBatch;
    /**
     * Generate operator reference ID (unique across operator)
     * Format: OPERATOR-TIMESTAMP-RANDOM
     */
    private generateOperatorRefId;
    /**
     * Generate batch reference ID for settlement
     */
    private generateBatchRefId;
    /**
     * Check if error is recoverable (retry-worthy)
     */
    private isRecoverableError;
    /**
     * Get next batch settlement time (typically 6 AM next day)
     */
    private getNextBatchTime;
    /**
     * Emit job status event via WebSocket
     */
    private emitJobStatusEvent;
    /**
     * Utility: Sleep for milliseconds
     */
    private delay;
    /**
     * Create a new async job
     * Returns job ID for status tracking
     */
    createJob(jobType: string, payload: Record<string, any>, transactionId?: string): Promise<string>;
    /**
     * Select appropriate gateway based on job type
     */
    private selectGatewayId;
}
