-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('MOBILE_IOS', 'MOBILE_ANDROID', 'TABLET_IOS', 'TABLET_ANDROID', 'WEB_DESKTOP', 'WEB_TABLET');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('SAVINGS', 'CURRENT', 'SIMULATION');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'FROZEN', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('UPI_TRANSFER', 'MOBILE_RECHARGE', 'UTILITY_BILL_PAYMENT', 'INTERNAL_TRANSFER', 'SIMULATION_CREDIT');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'ROLLED_BACK', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BlockchainStatus" AS ENUM ('PENDING', 'ANCHORED', 'VERIFIED', 'FAILED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "OperatorType" AS ENUM ('MOBILE_TELECOM', 'UTILITY_PROVIDER', 'PAYMENT_PROCESSOR');

-- CreateEnum
CREATE TYPE "GatewayStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('MOBILE_RECHARGE', 'UTILITY_PAYMENT', 'DISPUTE_RESOLUTION', 'SETTLEMENT_BATCH');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phoneNumber" VARCHAR(20),
    "passwordHash" VARCHAR(255) NOT NULL,
    "upiHandle" VARCHAR(50) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "kycVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "userAgent" VARCHAR(500) NOT NULL,
    "ipAddress" VARCHAR(45) NOT NULL,
    "deviceId" VARCHAR(255) NOT NULL,
    "expiresAt" TIMESTAMP NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" VARCHAR(255) NOT NULL,
    "pushToken" VARCHAR(1000) NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "registeredAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountNumber" VARCHAR(20) NOT NULL,
    "accountType" "AccountType" NOT NULL DEFAULT 'SAVINGS',
    "currency" CHAR(6) NOT NULL DEFAULT 'MYSIM',
    "currentBalance" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "rrn" VARCHAR(20) NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderAccountId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "receiverAccountId" TEXT NOT NULL,
    "amount" DECIMAL(16,6) NOT NULL,
    "currency" CHAR(6) NOT NULL DEFAULT 'MYSIM',
    "description" VARCHAR(500) NOT NULL,
    "transactionType" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(36) NOT NULL,
    "txHash" CHAR(66),
    "blockchainStatus" "BlockchainStatus" NOT NULL DEFAULT 'PENDING',
    "blockchainTxId" VARCHAR(255),
    "blockedAt" TIMESTAMP(3),
    "errorReason" TEXT,
    "failureRetries" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockchainAuditLog" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "txHash" CHAR(66) NOT NULL,
    "previousHash" CHAR(66),
    "blockNumber" BIGINT,
    "blockHash" CHAR(66),
    "gasUsed" BIGINT,
    "smartContractAddr" VARCHAR(42) NOT NULL,
    "eventSignature" VARCHAR(66) NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verificationProof" TEXT,
    "anchoredAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedToChainAt" TIMESTAMP(3),

    CONSTRAINT "BlockchainAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(36) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "responsePayload" TEXT NOT NULL,
    "method" VARCHAR(10) NOT NULL,
    "path" VARCHAR(500) NOT NULL,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP NOT NULL,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThirdPartyGateway" (
    "id" TEXT NOT NULL,
    "operatorName" VARCHAR(100) NOT NULL,
    "operatorType" "OperatorType" NOT NULL,
    "apiEndpoint" VARCHAR(500) NOT NULL,
    "apiKey" VARCHAR(500) NOT NULL,
    "status" "GatewayStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,

    CONSTRAINT "ThirdPartyGateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AsyncJob" (
    "id" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "transactionId" VARCHAR(36),
    "referenceId" VARCHAR(255) NOT NULL,
    "payload" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "responseData" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),

    CONSTRAINT "AsyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_upiHandle_key" ON "User"("upiHandle");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_upiHandle_idx" ON "User"("upiHandle");

-- CreateIndex
CREATE INDEX "User_kycStatus_idx" ON "User"("kycStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_tokenHash_idx" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_userId_deviceId_key" ON "Session"("userId", "deviceId");

-- CreateIndex
CREATE INDEX "DeviceToken_userId_idx" ON "DeviceToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_userId_deviceId_key" ON "DeviceToken"("userId", "deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_accountNumber_key" ON "Account"("accountNumber");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Account_accountNumber_idx" ON "Account"("accountNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Account_userId_accountType_key" ON "Account"("userId", "accountType");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_rrn_key" ON "Transaction"("rrn");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_txHash_key" ON "Transaction"("txHash");

-- CreateIndex
CREATE INDEX "Transaction_senderId_idx" ON "Transaction"("senderId");

-- CreateIndex
CREATE INDEX "Transaction_receiverId_idx" ON "Transaction"("receiverId");

-- CreateIndex
CREATE INDEX "Transaction_senderAccountId_idx" ON "Transaction"("senderAccountId");

-- CreateIndex
CREATE INDEX "Transaction_receiverAccountId_idx" ON "Transaction"("receiverAccountId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_blockchainStatus_idx" ON "Transaction"("blockchainStatus");

-- CreateIndex
CREATE INDEX "Transaction_createdAt_idx" ON "Transaction"("createdAt");

-- CreateIndex
CREATE INDEX "Transaction_rrn_idx" ON "Transaction"("rrn");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainAuditLog_transactionId_key" ON "BlockchainAuditLog"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainAuditLog_txHash_key" ON "BlockchainAuditLog"("txHash");

-- CreateIndex
CREATE INDEX "BlockchainAuditLog_transactionId_idx" ON "BlockchainAuditLog"("transactionId");

-- CreateIndex
CREATE INDEX "BlockchainAuditLog_txHash_idx" ON "BlockchainAuditLog"("txHash");

-- CreateIndex
CREATE INDEX "BlockchainAuditLog_blockNumber_idx" ON "BlockchainAuditLog"("blockNumber");

-- CreateIndex
CREATE INDEX "BlockchainAuditLog_verificationStatus_idx" ON "BlockchainAuditLog"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_idempotencyKey_key" ON "IdempotencyRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_userId_idx" ON "IdempotencyRecord"("userId");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_idempotencyKey_key" ON "IdempotencyRecord"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ThirdPartyGateway_operatorType_idx" ON "ThirdPartyGateway"("operatorType");

-- CreateIndex
CREATE UNIQUE INDEX "AsyncJob_referenceId_key" ON "AsyncJob"("referenceId");

-- CreateIndex
CREATE INDEX "AsyncJob_jobType_idx" ON "AsyncJob"("jobType");

-- CreateIndex
CREATE INDEX "AsyncJob_status_idx" ON "AsyncJob"("status");

-- CreateIndex
CREATE INDEX "AsyncJob_nextRetryAt_idx" ON "AsyncJob"("nextRetryAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_receiverAccountId_fkey" FOREIGN KEY ("receiverAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockchainAuditLog" ADD CONSTRAINT "BlockchainAuditLog_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AsyncJob" ADD CONSTRAINT "AsyncJob_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "ThirdPartyGateway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
