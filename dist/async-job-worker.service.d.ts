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
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
    private startWorker;
    private stopWorker;
    private processPendingJobs;
    private processJob;
    private handleMobileRecharge;
    private handleUtilityPayment;
    private handleSettlementBatch;
    private generateOperatorRefId;
    private generateBatchRefId;
    private isRecoverableError;
    private getNextBatchTime;
    private emitJobStatusEvent;
    private delay;
    createJob(jobType: string, payload: Record<string, any>, transactionId?: string): Promise<string>;
    private selectGatewayId;
}
