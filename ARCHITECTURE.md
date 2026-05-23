Core Banking Simulation Platform - Architecture Documentation
=================================================================

## TABLE OF CONTENTS
1. System Overview
2. Technology Stack
3. Architectural Patterns
4. Security Model
5. Data Flow
6. Deployment Guide
7. Performance Considerations
8. Troubleshooting

=================================================================
## 1. SYSTEM OVERVIEW
=================================================================

The Core Banking Simulation Platform is a production-grade, highly 
secure financial transaction platform implementing enterprise-level 
patterns for:

✓ Double-entry bookkeeping (GAAP-compliant)
✓ ACID-compliant distributed transactions
✓ Blockchain-anchored audit trails
✓ Real-time transaction updates
✓ Fraud prevention and idempotency
✓ Multi-device session management
✓ Asynchronous third-party integrations

### Key Components:

┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React)                      │
│  (Vite, TypeScript, Tailwind, Socket.IO client)         │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS/WSS
┌────────────────────▼────────────────────────────────────┐
│              NestJS API (Node.js v24)                    │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Controllers (REST endpoints)                    │   │
│  │  - POST /api/v1/transfers/initiate               │   │
│  │  - GET  /api/v1/transfers/{id}                   │   │
│  │  - POST /api/v1/auth/login                       │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Core Services                                   │   │
│  │  ├─ TransferService (Transactions + Locks)      │   │
│  │  ├─ BlockchainService (Smart contract calls)    │   │
│  │  ├─ AuthenticationService (JWT + Sessions)      │   │
│  │  ├─ AsyncJobWorkerService (Background tasks)    │   │
│  │  └─ WebSocketGateway (Real-time updates)        │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────┬─────────────────────────────────┬─┘
                      │                                 │
        ┌─────────────▼──────────────┐    ┌────────────▼──────────┐
        │   PostgreSQL Database      │    │   Redis Cache/Lock    │
        │ ┌──────────────────────┐   │    │ ┌──────────────────┐  │
        │ │Users                 │   │    │ │Distributed Locks │  │
        │ │Accounts              │   │    │ │Session Tracking  │  │
        │ │Transactions (Ledger) │   │    │ │Idempotency Cache │  │
        │ │BlockchainAuditLog    │   │    │ │Job Queues        │  │
        │ │Sessions              │   │    │ └──────────────────┘  │
        │ └──────────────────────┘   │    │                       │
        └────────────────────────────┘    └───────────────────────┘
                      │
        ┌─────────────▼──────────────┐
        │  Blockchain (Ethereum/Polygon/Hardhat)
        │  BankingAuditLedger.sol
        │  ├─ anchorTransaction()
        │  ├─ verifyTransaction()
        │  └─ Event logs
        └────────────────────────────┘

=================================================================
## 2. TECHNOLOGY STACK
=================================================================

Frontend:
  - React 18 with Vite (hot reload, fast builds)
  - TypeScript (strict mode)
  - Tailwind CSS (utility-first styling)
  - Socket.IO client (real-time updates)
  - Zustand (state management)

Backend:
  - Node.js v24 (latest LTS)
  - NestJS (enterprise framework)
  - TypeScript (strict mode)
  - Prisma (ORM, type-safe queries)
  - Express.js (web framework, built into NestJS)

Database:
  - PostgreSQL (ACID, row-level locking)
  - Prisma migrations (schema versioning)
  - Connection pooling (min 5, max 20 connections)

Caching/Locking:
  - Redis (6.0+, cluster-ready)
  - Redlock algorithm (distributed locks)
  - Session storage
  - Rate limit tracking

Blockchain:
  - Solidity ^0.8.20
  - ethers.js v6 (contract interaction)
  - EVM-compatible chains (Ethereum, Polygon, Hardhat)

Testing:
  - Jest (unit & integration tests)
  - Supertest (API endpoint testing)
  - Hardhat (local blockchain for testing)

DevOps:
  - Docker & Docker Compose
  - Kubernetes (optional, for production)
  - GitHub Actions (CI/CD)

=================================================================
## 3. ARCHITECTURAL PATTERNS
=================================================================

### 3.1 DOUBLE-ENTRY BOOKKEEPING
────────────────────────────────────

Every transaction creates TWO ledger entries:
  1. DEBIT: Sender's account (decreases balance)
  2. CREDIT: Receiver's account (increases balance)

Database Design:
  Accounts table:
    - id (UUID)
    - userId (foreign key)
    - currentBalance (Decimal, indexed)
    - status (ACTIVE, FROZEN, CLOSED)

  Transactions table (APPEND-ONLY):
    - id (UUID, primary)
    - rrn (unique, UPI Reference Number)
    - senderId / senderAccountId
    - receiverId / receiverAccountId
    - amount (Decimal, strictly positive)
    - status (PENDING → PROCESSING → SETTLED)
    - txHash (blockchain anchor)

Balance Calculation (Never Direct Storage):
  SELECT SUM(CASE 
    WHEN transaction.senderAccountId = account.id THEN -amount
    WHEN transaction.receiverAccountId = account.id THEN +amount
  END) AS calculated_balance
  FROM transactions
  WHERE status = 'SETTLED'
    AND (senderAccountId = ? OR receiverAccountId = ?)

This prevents balance tampering via database manipulation.

### 3.2 DISTRIBUTED LOCKING (Redlock Algorithm)
─────────────────────────────────────────────────

Problem: Two concurrent transfers from same account cause double-spending
Solution: Redis-based distributed locks per account

Lock Acquisition:
  1. Sort account IDs alphabetically (prevents deadlock)
  2. SET lock:accountId1 token EX 30 NX
  3. SET lock:accountId2 token EX 30 NX
  4. If both succeed, proceed with transaction
  5. If either fails, release and retry with backoff

Lock Structure:
  Key: lock:{accountId}
  Value: {tokenUUID} (for ownership verification)
  TTL: 30 seconds (auto-expire if process dies)

Release:
  Compare token to verify ownership, then DELETE

Benefits:
  ✓ Prevents concurrent transactions on same account
  ✓ Auto-releases if service crashes
  ✓ Fast (O(1) Redis operation)
  ✓ Scales across multiple servers

### 3.3 SERIALIZABLE TRANSACTION ISOLATION
──────────────────────────────────────────

PostgreSQL Isolation Level: SERIALIZABLE
  
  Ensures:
  - No dirty reads (uncommitted data)
  - No non-repeatable reads (data changed mid-transaction)
  - No phantom reads (new rows appeared)
  - Serializable (appears as if transactions ran sequentially)

Implementation:
  prisma.$transaction(
    async (tx) => {
      // All queries use same transaction context
      // Automatically rolls back if any query fails
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  )

Timeout: 15 seconds (prevents long locks)

### 3.4 IDEMPOTENCY WITH 120-SECOND WINDOW
──────────────────────────────────────────

Problem: Client retries same transfer → double-charge
Solution: Track X-Idempotency-Key header (UUIDv4) in Redis

Flow:
  1. Client includes X-Idempotency-Key: {UUIDv4} in request
  2. Server checks Redis: idempotency:{userId}:{key}
  3. If found: Return cached response (same transaction ID)
  4. If not found: Process transfer, cache response for 120 seconds

Cache Structure:
  Key: idempotency:{userId}:{idempotencyKey}
  Value: {cached_response_json}
  TTL: 120 seconds

DatabaseTracking:
  IdempotencyRecord table:
    - idempotencyKey (unique per user)
    - responsePayload (cached JSON)
    - expiresAt (120 second window)

### 3.5 BLOCKCHAIN ANCHORING (Non-Blocking)
──────────────────────────────────────────

Pattern: Fire-and-forget to prevent slow blockchain from blocking users

Flow:
  1. Transaction SETTLED off-chain in PostgreSQL
  2. Async fire TransferService.submitBlockchainAnchor()
  3. Blockchain service attempts to record hash on-chain
  4. If succeeds: Update BlockchainAuditLog.status = ANCHORED
  5. If fails: Retry with exponential backoff (background job)

Transaction Hash Generation:
  sha256(senderId + receiverId + amount + timestamp)
  → 0x{64_char_hex}

Smart Contract Recording:
  function anchorTransaction(
    bytes32 txHash,
    bytes32 previousHash,    // Chain of custody
    address senderAddr,
    address receiverAddr,
    uint256 amount,
    uint256 timestamp
  )

Benefits:
  ✓ Users don't wait for blockchain (UX improvement)
  ✓ Off-chain settlement is immediate
  ✓ Blockchain is audit trail, not operational dependency
  ✓ Supports both public chains and private ledgers

### 3.6 REAL-TIME UPDATES VIA WEBSOCKET
───────────────────────────────────────

WebSocket Rooms:
  - user:{userId}         → User-specific events
  - transaction:{txId}    → Transaction-specific updates
  - account:{accountId}   → Account balance changes

Broadcasting:
  TransferService completion
    → WebSocketBroadcastService.notifyTransactionUpdate()
    → TransactionWebSocketGateway.broadcastTransactionUpdate()
    → socket.io.to(`transaction:${txId}`).emit('transaction:updated')

Client-side (React):
  useEffect(() => {
    socket.on('transaction:updated', (data) => {
      // Real-time UI update
      setTransactionStatus(data.status);
    });
  }, []);

Fallback: Polling every 5 seconds if WebSocket unavailable

### 3.7 MULTI-DEVICE SESSION MANAGEMENT
──────────────────────────────────────

Database Tracking (Session table):
  - sessionId (UUID)
  - userId (foreign key)
  - deviceId (client-provided identifier)
  - userAgent (browser info)
  - ipAddress (for fraud detection)
  - expiresAt (24-hour TTL)
  - revokedAt (explicit logout)

JWT Payload:
  {
    sub: userId,
    email: user@example.com,
    sessionId: {uuid},
    deviceId: device-xyz,
    iat: 1705600000,
    exp: 1705686400
  }

Session Validation:
  1. Verify JWT signature
  2. Check sessionId exists in Redis (not revoked)
  3. Verify user.kycStatus == VERIFIED
  4. Allow request

Logout Options:
  - Single device: Revoke specific sessionId
  - All devices: Delete all sessions for userId

=================================================================
## 4. SECURITY MODEL
=================================================================

### 4.1 AUTHENTICATION
────────────────────

Method: JWT Bearer Tokens (HttpOnly Cookies)
Token Lifetime: 60 minutes
Refresh Token: 7 days

Header: Authorization: Bearer {jwt_token}
Cookie: Set-Cookie: accessToken=....; HttpOnly; Secure; SameSite=Strict

Verification:
  1. Extract token from Authorization header
  2. Verify JWT signature with secret
  3. Check expiration (iat, exp claims)
  4. Validate session exists in Redis
  5. Verify user KYC status

### 4.2 REQUEST VALIDATION
────────────────────────

All inputs validated at controller entry point:

DTOs (Data Transfer Objects):
  class InitiateTransferDTO {
    @IsUpiHandle() receiverHandle: string;
    @IsValidAmount() amount: number;
  }

Validators:
  - UPI Handle: /^[a-zA-Z0-9._-]+@mybank$/
  - Amount: Positive, ≤ 6 decimal places, ≤ 999,999.99
  - RRN: YYYY + DDD (day) + 6 hex
  - Transaction Hash: 0x + 64 hex chars
  - Email: Standard RFC 5322
  - UUID: v4 format

Prisma ORM:
  - Prevents SQL injection via parameterized queries
  - Type-safe queries (TypeScript compiler)

### 4.3 RACE CONDITION PREVENTION
─────────────────────────────────

Level 1: Distributed Locks (Redis)
  - Prevents concurrent account access
  - 30-second timeout with auto-release

Level 2: Row-Level Locking (PostgreSQL)
  - SELECT ... FOR UPDATE (pessimistic lock)
  - Database-level serialization

Level 3: SERIALIZABLE Isolation
  - PostgreSQL detects phantom reads
  - Automatic transaction rollback if conflict

Sequence:
  1. Acquire Redis locks on both accounts
  2. Open database transaction (SERIALIZABLE)
  3. SELECT balance FOR UPDATE (row lock)
  4. Verify sufficient balance
  5. INSERT transaction record
  6. UPDATE both account balances
  7. Commit transaction
  8. Release Redis locks

### 4.4 XSS, CSRF, CLICKJACKING PROTECTION
──────────────────────────────────────────

XSS Prevention:
  - Content-Security-Policy header
  - HttpOnly cookies (not accessible via JavaScript)
  - Input sanitization via Prisma + Zod

CSRF Prevention:
  - SameSite=Strict cookie attribute
  - No credential cookies on cross-site requests

Clickjacking Protection:
  - X-Frame-Options: DENY
  - X-Content-Type-Options: nosniff

Headers Middleware:
  X-Frame-Options: DENY
  X-XSS-Protection: 1; mode=block
  Strict-Transport-Security: max-age=31536000
  Content-Security-Policy: default-src 'self'

### 4.5 RATE LIMITING
─────────────────────

Token Bucket Algorithm (per IP):
  - 100 requests per 60 seconds
  - Checked via Redis INCR + EXPIRE

Headers:
  X-RateLimit-Limit: 100
  X-RateLimit-Remaining: 95
  X-RateLimit-Reset: 1705686400

Per-User Limits:
  - 10 transfers per minute
  - 50 failed login attempts per IP → 15-minute block

### 4.6 DATA ENCRYPTION
───────────────────────

At Rest (In Database):
  - Sensitive fields encrypted with AES-256-GCM
  - Encryption key in environment (never committed)
  - Decrypt on retrieval

In Transit:
  - HTTPS (TLS 1.3+) for API
  - WSS (Secure WebSocket) for real-time

Database Passwords:
  - bcrypt (12 rounds)
  - Never stored as plaintext
  - Always hashed before storage

### 4.7 SECRETS MANAGEMENT
────────────────────────

Production Deployment:
  Use AWS Secrets Manager, HashiCorp Vault, or GitHub Secrets

Never:
  ✗ Commit .env with real keys
  ✗ Log sensitive data (passwords, tokens)
  ✗ Send tokens in URLs
  ✗ Store secrets in code comments

Environment Variables (Secrets):
  - JWT_SECRET (generate: openssl rand -base64 32)
  - BLOCKCHAIN_PRIVATE_KEY (never log)
  - DATABASE_URL with password
  - ENCRYPTION_KEY (AES-256)

=================================================================
## 5. DATA FLOW - UPI TRANSFER EXAMPLE
=================================================================

SCENARIO: User A (@alice) transfers ₹500 to User B (@bob)

Timeline (t = 0ms):
──────────────────

[Client] POST /api/v1/transfers/initiate
         Body: { receiverHandle: "bob@mybank", amount: 500 }
         Headers: {
           Authorization: Bearer {jwt},
           X-Idempotency-Key: {uuid-v4},
           X-Device-ID: device-xyz
         }

[Server] TransferController.initiateTransfer()
├─ Validate idempotency key (UUID format)
├─ Check idempotency cache: Redis.get(idempotency:alice:key)
│  → Cache miss, proceed
├─ Validate request (UPI, amount, description)
├─ Resolve receiver: Prisma.user.findUnique({upiHandle: "bob@mybank"})
├─ Fetch both accounts

[t = 50ms] TransferService.executeTransfer()
├─ Acquire distributed locks:
│  ├─ Redis.set(lock:account_alice_id, uuid, EX 30, NX)
│  ├─ Redis.set(lock:account_bob_id, uuid, EX 30, NX)
├─ Read locked balance:
│  └─ SELECT currentBalance FROM accounts WHERE id = alice_id FOR UPDATE
│     → 1000 MYSIM
├─ Verify sufficient balance
│  └─ 1000 > 500 ✓

[t = 100ms] Database Transaction (SERIALIZABLE)
├─ BEGIN TRANSACTION
├─ Generate RRN: "2024018A4F7C9E"
├─ Generate txHash: sha256("alice_id" + "bob_id" + "500" + "2024-01-18T...")
│  → "0x8f9c5c7a3b1d2e4f6a8b9c0d1e2f3a4b5c6d7e..."
├─ INSERT transaction record:
│  INSERT INTO transactions (
│    id, rrn, senderId, senderAccountId, receiverId, receiverAccountId,
│    amount, description, status, blockchainStatus, idempotencyKey, txHash
│  ) VALUES (...)
│  → Created with status = PROCESSING
├─ UPDATE sender balance (DEBIT):
│  UPDATE accounts SET currentBalance = 1000 - 500 = 500 WHERE id = alice_id
├─ UPDATE receiver balance (CREDIT):
│  UPDATE accounts SET currentBalance = 0 + 500 = 500 WHERE id = bob_id
├─ Verify no negative balance: 500 >= 0 ✓
├─ COMMIT TRANSACTION (all or nothing)

[t = 150ms] Post-Transaction Updates
├─ UPDATE transaction SET status = SETTLED, settledAt = NOW()
├─ Cache idempotency response:
│  └─ Redis.setex(idempotency:alice:key, 120, {response_json})
├─ Fire blockchain anchor (non-blocking):
│  └─ submitBlockchainAnchor(txId, txHash) → async
├─ Release distributed locks:
│  ├─ Redis.del(lock:alice_id)
│  ├─ Redis.del(lock:bob_id)

[t = 160ms] Response to Client
{
  "success": true,
  "transactionId": "clx8a4kp2000109jy0z5p8v6e",
  "rrn": "2024018A4F7C9E",
  "txHash": "0x8f9c5c7a3b1d2e4f6a8b9c0d...",
  "blockchainStatus": "PENDING",
  "message": "Transfer of 500 MYSIM to bob@mybank successful",
  "timestamp": "2024-01-18T10:30:45.123Z"
}

[Parallel] Blockchain Anchoring (t = 200-5000ms)
├─ BlockchainService.anchorTransaction()
├─ Derive Ethereum addresses (HMAC-SHA256 hash of IDs)
├─ Submit to smart contract:
│  └─ BankingAuditLedger.anchorTransaction(
│      txHash, previousHash, senderAddr, receiverAddr, amount, timestamp
│    )
├─ Wait for 2 block confirmations
├─ Update BlockchainAuditLog:
│  └─ status = ANCHORED, blockNumber = 12345678
├─ On-chain event emitted:
│  └─ TransactionAnchored(txHash, blockNumber, timestamp)

[Parallel] Real-Time Updates (t = 150-200ms)
├─ WebSocketGateway.broadcastTransactionUpdate()
├─ Emit to subscribed clients:
│  ├─ socket.io.to(`user:alice_id`).emit('transaction:updated', ...)
│  ├─ socket.io.to(`user:bob_id`).emit('transaction:updated', ...)
│  ├─ socket.io.to(`transaction:txId`).emit('transaction:updated', ...)
├─ Update UI in real-time:
│  ├─ Alice sees: "Transfer sent, status: SETTLED ✓"
│  ├─ Bob sees: "Received ₹500 from alice@mybank ✓"

IDEMPOTENCY TEST (Client retries at t=5s):
─────────────────────────────────────────

[Client] POST /api/v1/transfers/initiate (same request)
         X-Idempotency-Key: {same-uuid}

[Server] TransferController.initiateTransfer()
├─ Check idempotency cache:
│  └─ Redis.get(idempotency:alice:key)
│     → Cache HIT! Return cached response
│  └─ No new transaction created
│  └─ Same RRN returned

Response: Same as before (within 120-second window)

FAILURE SCENARIO (Blockchain submit fails):
───────────────────────────────────────────

If blockchain anchor fails:
├─ Transaction already SETTLED in database ✓
├─ User sees success (settlement is off-chain)
├─ Async worker retries with exponential backoff
├─ If max retries exceeded:
│  └─ Mark as DEAD_LETTER in AsyncJob table
│  └─ Alert admin for manual investigation
├─ Off-chain settlement guarantees + eventual blockchain anchor

=================================================================
## 6. DEPLOYMENT GUIDE
=================================================================

### 6.1 PREREQUISITES
─────────────────

Hardware (Minimum):
  - 2 CPU cores
  - 4 GB RAM
  - 20 GB SSD

Software:
  - Docker 20.10+
  - Docker Compose 1.29+
  - PostgreSQL 14+
  - Redis 6.0+
  - Node.js v24

### 6.2 LOCAL DEVELOPMENT
────────────────────────

Setup:
  1. Clone repository
  2. Copy .env.example → .env.local
  3. Update DATABASE_URL, REDIS_URL, JWT_SECRET
  4. docker-compose up -d
  5. npx prisma migrate dev
  6. npm install && npm run dev

docker-compose.yml:
  services:
    postgres:
      image: postgres:15
      environment:
        POSTGRES_USER: banking_user
        POSTGRES_PASSWORD: dev_password
        POSTGRES_DB: core_banking_db
      ports:
        - "5432:5432"

    redis:
      image: redis:7
      ports:
        - "6379:6379"

    hardhat:
      image: hardhat:latest
      ports:
        - "8545:8545"

Running:
  npm run dev          # Start with hot reload
  npm run test         # Run Jest tests
  npm run build        # Production build
  npm run start        # Run compiled code

### 6.3 STAGING DEPLOYMENT
────────────────────────

Environment: *.staging.env
Configuration:
  - NODE_ENV=staging
  - DATABASE_URL=postgresql://prod_user:***@rds.staging:5432/banking
  - REDIS_URL=redis://elasticache.staging:6379
  - BLOCKCHAIN_RPC_URL=https://sepolia.infura.io/v3/***
  - BLOCKCHAIN_PRIVATE_KEY=0x*** (from Vault)

CI/CD Pipeline (GitHub Actions):
  1. Run tests on PR
  2. Build Docker image
  3. Push to ECR/DockerHub
  4. Deploy to Kubernetes staging
  5. Run smoke tests
  6. Require approval for prod

### 6.4 PRODUCTION DEPLOYMENT
──────────────────────────

Infrastructure (AWS Example):
  - RDS PostgreSQL (Multi-AZ, automated backups)
  - ElastiCache Redis (Cluster mode enabled)
  - ECS Fargate (Containerized services)
  - Application Load Balancer (SSL/TLS termination)
  - CloudFront (CDN for static assets)
  - Route 53 (DNS)
  - CloudWatch (Logging & monitoring)

Deployment:
  1. Use Kubernetes or Docker Swarm
  2. Helm charts for configuration
  3. Zero-downtime rolling updates
  4. Database migrations in separate step
  5. Blue-green deployment for major versions

Database:
  - PostgreSQL 14+ with streaming replication
  - Automated backups to S3 (daily, 30-day retention)
  - Point-in-time recovery enabled
  - Read replicas for analytics

Blockchain:
  - Use Polygon Mainnet (faster, cheaper than Ethereum)
  - Or private Hyperledger Fabric for permissioned network

Monitoring:
  - Prometheus + Grafana (metrics)
  - ELK Stack (logs: Elasticsearch, Logstash, Kibana)
  - Sentry (error tracking)
  - PagerDuty (alerting)

### 6.5 SCALING CONSIDERATIONS
──────────────────────────────

Horizontal Scaling:
  ✓ Stateless API servers (multiple replicas)
  ✓ Load balancer distributes requests
  ✓ Shared PostgreSQL + Redis
  ✓ WebSocket: Use Redis Pub/Sub for server-to-server messaging

Database:
  - Connection pooling: min 5 * num_servers, max 20 * num_servers
  - Read replicas for analytics queries
  - Partitioning transactions table by date if > 100M rows

Redis:
  - Redis Cluster for 100K+ QPS
  - Redis Sentinel for HA
  - Keyspace notifications for cache invalidation

API Rate Limiting:
  - Per IP: 100 req/60sec (Redis)
  - Per user: 10 transfers/min (Redis)
  - Global: Use API Gateway rate limit

Job Worker:
  - Run multiple worker instances
  - Lease jobs from database (avoid duplicate processing)
  - Dead letter queue for failed jobs

=================================================================
## 7. PERFORMANCE CONSIDERATIONS
=================================================================

### 7.1 QUERY OPTIMIZATION
────────────────────────

Indexes:
  CREATE INDEX idx_transactions_senderId ON transactions(senderId);
  CREATE INDEX idx_transactions_receiverId ON transactions(receiverId);
  CREATE INDEX idx_transactions_status ON transactions(status);
  CREATE INDEX idx_transactions_createdAt ON transactions(createdAt DESC);
  CREATE INDEX idx_sessions_userId ON sessions(userId);
  CREATE INDEX idx_idempotency ON idempotency_records(userId, idempotencyKey);

Avoid:
  ✗ SELECT * (specify columns)
  ✗ N+1 queries (use include/join)
  ✗ Full table scans (use WHERE with indexed columns)

### 7.2 CACHING STRATEGY
──────────────────────

What to Cache:
  ✓ User profile (ttl: 1 hour)
  ✓ Account balance (ttl: 5 minutes)
  ✓ Exchange rates (ttl: 15 minutes)
  ✓ KYC status (ttl: 24 hours)
  ✓ Operator configurations (ttl: 1 hour)

What NOT to Cache:
  ✗ Real-time transaction history (stale data risk)
  ✗ Account balances (must be fresh)
  ✗ Session data (use Redis, not memcached)

Cache Invalidation:
  - TTL-based (preferred)
  - Event-based (publish balance:updated, invalidate cache)
  - Manual (admin endpoint to clear cache)

### 7.3 RESPONSE TIMES (Target)
──────────────────────────────

API Endpoints:
  POST /transfers/initiate:  < 200ms (p99)
  GET  /transfers/{id}:      < 100ms (p99)
  GET  /transactions:        < 500ms (p99)

Blockchain:
  Anchor submission:         < 15 seconds (waits for 2 blocks)
  Verification:              < 100ms (state query)

WebSocket:
  Message delivery:          < 100ms
  Connection establishment:  < 500ms

### 7.4 LOAD TESTING
──────────────────

Tools: k6, Locust, Apache JMeter

Scenario 1: Normal Load (100 concurrent users)
  - 10 transfers/user/hour
  - Expected response time: 150ms

Scenario 2: Peak Load (1000 concurrent users)
  - 50 transfers/second
  - Expected response time: 300ms

Scenario 3: Stress Test (push to limits)
  - 500 transfers/second
  - Identify breaking point
  - Verify graceful degradation

=================================================================
## 8. TROUBLESHOOTING
=================================================================

### Issue: Transaction Timeout (Lock Not Released)
──────────────────────────────────────────────────

Symptoms:
  - POST /transfers/initiate returns 409 Conflict
  - Lock timeout after 30 seconds

Cause:
  - Deadlock in database query
  - Service crashed while holding lock
  - Database query taking > 30 seconds

Solution:
  1. Check Redis: redis-cli GET lock:{accountId}
  2. Manual unlock: redis-cli DEL lock:{accountId}
  3. Verify no active transactions: SELECT * FROM transactions WHERE status = 'PROCESSING'
  4. Check logs for timeout errors
  5. Increase lock timeout if legitimate long-running queries

### Issue: Balance Mismatch
────────────────────────────

Symptoms:
  - accounts.currentBalance ≠ calculated sum of transactions
  - User reports incorrect balance

Root Cause Analysis:
  1. Check for failed transactions:
     SELECT * FROM transactions WHERE status = 'FAILED' OR 'ROLLED_BACK'

  2. Verify transaction ledger integrity:
     SELECT SUM(CASE 
       WHEN senderId = ? THEN -amount
       WHEN receiverId = ? THEN +amount
     END) FROM transactions WHERE status = 'SETTLED'

  3. Check for orphaned updates:
     SELECT * FROM accounts WHERE id = ?
     -- Compare currentBalance with calculated sum

Solution:
  - Recalculate and update balance from ledger:
    UPDATE accounts SET currentBalance = (
      SELECT SUM(CASE ...) FROM transactions
    ) WHERE id = ?

  - Investigate and mark transaction anomalies
  - Alert auditor for manual review

### Issue: Blockchain Anchor Failing
────────────────────────────────────

Symptoms:
  - blockchainStatus = FAILED for recent transactions
  - SmartContract call reverts

Check:
  1. Verify wallet has sufficient balance:
     ethers.provider.getBalance(walletAddress)

  2. Check gas prices:
     ethers.provider.getGasPrice()

  3. Verify contract address:
     ethers.provider.getCode(contractAddress)

  4. Inspect transaction revert reason:
     try { await contract.anchorTransaction(...) }
     catch (e) { console.log(e.reason) } // "Previous transaction not found"

Solutions:
  - Top up wallet balance
  - Increase gas price (during congestion)
  - Check if previous transactions pending (wait for confirmation)
  - Verify chain is in sync (check block number)

### Issue: High Memory Usage (Memory Leak)
──────────────────────────────────────────

Check:
  1. Monitor process memory: top -p $(pgrep -f "node app")
  2. Node.js heap snapshot: node --inspect --expose-gc app.js
  3. Chrome DevTools: chrome://inspect → Memory tab

Common Causes:
  - WebSocket connections not closed
  - Redis pub/sub subscribers growing
  - Prisma client not disposed
  - Circular object references

Fix:
  - Ensure proper cleanup in finally blocks
  - Test with: node --max-old-space-size=512 app.js (limit heap)
  - Use memory profilers (clinic.js, 0x)

### Issue: Race Condition Still Occurring
─────────────────────────────────────────

Symptoms:
  - Two concurrent transfers both succeeded from same account
  - Final balance is negative (should be impossible)

Verify Locking:
  1. Check lock acquisition logging:
     grep "LOCK-ACQUIRED" logs/* | wc -l
     grep "LOCK-FAILED" logs/*

  2. Verify Redis is running:
     redis-cli ping → PONG

  3. Check transaction isolation level:
     SHOW transaction_isolation; → serializable

  4. Verify pessimistic lock:
     EXPLAIN ANALYZE SELECT ... FROM accounts ... FOR UPDATE

Solution:
  - Increase lock timeout (30s → 60s)
  - Add circuit breaker (fail fast if lock unavailable)
  - Implement distributed mutex (Redlock gem)
  - Add database constraint: CHECK (currentBalance >= 0)

=================================================================
## END OF DOCUMENTATION
=================================================================

For questions or issues:
  - GitHub Issues: https://github.com/banking-platform/issues
  - Email: dev@mybank.local
  - Slack: #banking-platform-dev
