/**
 * @file upi-payment.service.ts
 * @description Production-grade UPI Payment Processing Service
 *
 * Security & Correctness Layers (in execution order):
 *   1. Two-phase Redis idempotency  — stops duplicate clicks at the gate
 *   2. Distributed Redlock          — one concurrent execution per account pair
 *   3. Prisma SERIALIZABLE tx       — ACID wrapper for the money movement
 *   4. SELECT FOR UPDATE (raw SQL)  — row-level pessimistic lock on balances
 *   5. Negative-balance guard       — second-opinion check after decrement
 *   6. Blockchain anchor            — cryptographic audit trail on-chain
 *   7. Full Prisma rollback         — any failure marks ROLLED_BACK, never orphaned
 */

import {
  Injectable,
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { BlockchainService } from './blockchain.service';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from '@prisma/client/runtime/library';
import * as crypto from 'crypto';

// ============================================================================
// CONSTANTS
// ============================================================================

/** How long a completed result is cached for idempotent replay (seconds). */
const IDEMPOTENCY_RESULT_TTL_SEC = 120;

/** How long an "in-flight" sentinel lives before expiring (seconds).
 *  Guards against a server crash leaving the sentinel forever. */
const IDEMPOTENCY_INFLIGHT_TTL_SEC = 45;

/** Distributed lock TTL — must exceed the longest DB transaction we expect. */
const LOCK_TTL_SEC = 30;

/** How long we busy-wait for a lock before giving up. */
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;

/** Back-off between lock-retry attempts. */
const LOCK_RETRY_INTERVAL_MS = 200;

/** Maximum single UPI transfer amount (regulatory ceiling). */
const MAX_TRANSFER_AMOUNT = 100_000;

/** Minimum amount to prevent dust transactions. */
const MIN_TRANSFER_AMOUNT = 0.01;

/** Max decimal precision allowed. */
const MAX_DECIMAL_PLACES = 6;

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/** ISO-8601 timestamp string brand type. */
type ISO8601String = string;

export interface UpiPaymentRequest {
  /** Authenticated sender's user ID (injected by AuthGuard, not client-supplied). */
  senderId: string;
  /** UPI Virtual Payment Address of the recipient — e.g. "alice@mybank". */
  receiverUpiHandle: string;
  /** Transfer amount in MYSIM (decimal, positive). */
  amount: number;
  /** Human-readable narration, max 500 chars. */
  description: string;
  /** Client-generated UUIDv4 from X-Idempotency-Key header. */
  idempotencyKey: string;
}

export interface UpiPaymentResult {
  success: boolean;
  transactionId: string;
  /** UPI Reference Reference Number — format: YYYY-DDD-XXXXXX. */
  rrn: string;
  /** SHA-256 fingerprint committed to the blockchain. */
  txHash: string;
  /** Whether the blockchain anchor is settled or queued. */
  blockchainStatus: 'PENDING' | 'ANCHORED' | 'FAILED';
  message: string;
  timestamp: ISO8601String;
}

/** Slim account row returned by the SELECT FOR UPDATE query. */
interface LockedAccountRow {
  id: string;
  userId: string;
  currentBalance: string; // PostgreSQL DECIMAL comes back as string
  currency: string;
  status: string;
}

/** Shape of a cached "in-flight" idempotency sentinel. */
interface IdempotencySentinel {
  status: 'processing';
  startedAt: ISO8601String;
}

// ============================================================================
// CUSTOM ERROR CLASSES
// ============================================================================

/** Thrown when a duplicate idempotency key is detected while still processing. */
class RequestInFlightException extends ConflictException {
  constructor(idempotencyKey: string) {
    super(
      `Request ${idempotencyKey} is already being processed. Retry in a moment.`,
    );
  }
}

/** Thrown when the sender's balance is insufficient. */
class InsufficientFundsException extends UnprocessableEntityException {
  constructor(available: string, requested: string) {
    super(
      `Insufficient balance. Available: ${available} MYSIM, Requested: ${requested} MYSIM.`,
    );
  }
}

/** Thrown when the balance guard catches a race-condition negative result. */
class BalanceIntegrityException extends InternalServerErrorException {
  constructor(accountId: string) {
    super(
      `Balance integrity check failed for account ${accountId}. Transaction rolled back.`,
    );
  }
}

// ============================================================================
// UPI PAYMENT SERVICE
// ============================================================================

@Injectable()
export class UpiPaymentService {
  private readonly logger = new Logger(UpiPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly blockchain: BlockchainService,
    private readonly config: ConfigService,
  ) {}

  // ==========================================================================
  // PUBLIC API — Entry Point
  // ==========================================================================

  /**
   * Process a peer-to-peer UPI payment end-to-end.
   *
   * Execution contract:
   *   - **Idempotent**: Identical idempotency keys within the 120-second window
   *     return the cached result without re-executing.
   *   - **Atomic**: The debit, credit, and ledger record either all commit or
   *     all roll back — no partial state is possible.
   *   - **Consistent**: Balances are locked at the row level before any
   *     arithmetic, preventing phantom reads across concurrent transfers.
   *   - **Durable**: A blockchain hash is anchored asynchronously for audit.
   */
  async processUpiPayment(request: UpiPaymentRequest): Promise<UpiPaymentResult> {
    const correlationId = uuidv4(); // For distributed log tracing
    this.logger.log(
      `[UPI][${correlationId}] Initiating transfer ` +
        `${request.senderId} → ${request.receiverUpiHandle} | ` +
        `amount=${request.amount} | idem=${request.idempotencyKey}`,
    );

    // Track IDs for cleanup in `finally`
    let senderAccountId: string | null = null;
    let receiverAccountId: string | null = null;
    let acquiredLocks: string[] = [];
    let pendingTransactionId: string | null = null;

    try {
      // ======================================================================
      // PHASE 1 — INPUT VALIDATION
      // Fast-fail before any I/O; no charges, no state written.
      // ======================================================================
      this.validateRequest(request);

      // ======================================================================
      // PHASE 2 — IDEMPOTENCY CHECK (Two-phase Redis protocol)
      //
      // Why two-phase?
      //   A naive single SET approach has a TOCTOU gap: two concurrent
      //   requests with the same key both arrive before either sets the key,
      //   both pass the check, and both execute the payment.
      //
      // Our protocol:
      //   A. Atomically SET an "in-flight" sentinel (NX, short TTL).
      //      → Only one thread wins; the other gets RequestInFlightException.
      //   B. Before setting the sentinel, check for an existing *result* key.
      //      → A replay within the window returns the cached response.
      //   C. After successful payment, overwrite the sentinel with the result
      //      (longer TTL) so replays within 120 s get the cached outcome.
      // ======================================================================
      const cachedResult = await this.lookupIdempotencyResult(
        request.senderId,
        request.idempotencyKey,
      );
      if (cachedResult !== null) {
        this.logger.log(
          `[UPI][${correlationId}][IDEMPOTENCY] Cache hit — returning stored result.`,
        );
        return cachedResult;
      }

      const sentinelAcquired = await this.acquireIdempotencySentinel(
        request.senderId,
        request.idempotencyKey,
      );
      if (!sentinelAcquired) {
        // Another thread is already processing this exact request.
        throw new RequestInFlightException(request.idempotencyKey);
      }

      // ======================================================================
      // PHASE 3 — RESOLVE RECEIVER ACCOUNT
      // Read-only lookup; no locks held yet.
      // ======================================================================
      const receiver = await this.resolveReceiverAccount(
        request.receiverUpiHandle,
        request.senderId,
      );
      receiverAccountId = receiver.accountId;

      const senderAccountMeta = await this.resolveSenderAccount(request.senderId);
      senderAccountId = senderAccountMeta.id;

      // ======================================================================
      // PHASE 4 — ACQUIRE DISTRIBUTED LOCKS (Redlock-style)
      //
      // We lock *both* accounts before entering the DB transaction.
      // Locks are always acquired in sorted key order to prevent deadlocks
      // between two concurrent transfers that involve the same account pair
      // in opposite directions (A→B and B→A running simultaneously).
      // ======================================================================
      const lockKeys = this.sortedLockKeys(senderAccountId, receiverAccountId);
      acquiredLocks = await this.acquireLocksWithTimeout(lockKeys, correlationId);

      // ======================================================================
      // PHASE 5 — GENERATE TRANSACTION IDENTIFIERS
      // IDs are generated *before* the DB tx so they can be embedded in the
      // hash and referenced in error logs even if the commit fails.
      // ======================================================================
      const rrn = this.generateRrn();
      const txHash = this.generateTxHash({
        senderId: request.senderId,
        receiverId: receiver.userId,
        amount: String(request.amount),
        rrn,
        idempotencyKey: request.idempotencyKey,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(
        `[UPI][${correlationId}] Identifiers — RRN=${rrn} | txHash=${txHash.slice(0, 18)}…`,
      );

      // ======================================================================
      // PHASE 6 — ATOMIC DATABASE TRANSACTION
      //
      // Prisma runs this inside a single PostgreSQL transaction with
      // SERIALIZABLE isolation. Inside, we use SELECT … FOR UPDATE to obtain
      // row-level locks on both Account rows before reading their balances.
      //
      // Why SELECT FOR UPDATE *inside* a Prisma transaction instead of relying
      // on SERIALIZABLE alone?
      //   SERIALIZABLE can retry the whole transaction on conflict; it never
      //   blocks competing reads the way FOR UPDATE does. For financial debit/
      //   credit, we want hard blocking — no other transaction may read (let
      //   alone modify) either balance row until we commit.
      //
      // Transaction steps (double-entry bookkeeping):
      //   6a. SELECT sender + receiver accounts FOR UPDATE  ← hard block
      //   6b. Validate sender balance ≥ amount
      //   6c. INSERT Transaction record (status=PROCESSING)
      //   6d. UPDATE sender  currentBalance -= amount
      //   6e. UPDATE receiver currentBalance += amount
      //   6f. Guard: reject if sender balance went negative (race safety net)
      //   6g. UPDATE Transaction (status=SETTLED)
      //   ← COMMIT (all six writes are atomic)
      // ======================================================================
      const transferAmount = new Decimal(request.amount);

      const committedTransaction = await this.prisma.$transaction(
        async (tx) => {
          // ----------------------------------------------------------------
          // 6a — SELECT FOR UPDATE: Lock both account rows
          // ----------------------------------------------------------------
          const [lockedSender, lockedReceiver] = await this.lockAccountRows(
            tx,
            senderAccountId!,
            receiverAccountId!,
          );

          if (lockedSender.status !== 'ACTIVE') {
            throw new BadRequestException(
              `Sender account is not active (status: ${lockedSender.status}).`,
            );
          }
          if (lockedReceiver.status !== 'ACTIVE') {
            throw new BadRequestException(
              `Receiver account is not active (status: ${lockedReceiver.status}).`,
            );
          }

          // ----------------------------------------------------------------
          // 6b — Balance sufficiency check (against the FOR UPDATE snapshot)
          // ----------------------------------------------------------------
          const senderBalance = new Decimal(lockedSender.currentBalance);
          if (senderBalance.lessThan(transferAmount)) {
            throw new InsufficientFundsException(
              senderBalance.toFixed(2),
              transferAmount.toFixed(2),
            );
          }

          // ----------------------------------------------------------------
          // 6c — Create Transaction ledger record (status = PROCESSING)
          //      Inserted first so we have a transactionId even if later
          //      steps fail, enabling reconciliation in error logs.
          // ----------------------------------------------------------------
          const txRecord = await tx.transaction.create({
            data: {
              rrn,
              senderId: request.senderId,
              senderAccountId: senderAccountId!,
              receiverId: receiver.userId,
              receiverAccountId: receiverAccountId!,
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

          // ----------------------------------------------------------------
          // 6d — Debit sender (atomic decrement inside the locked row)
          // ----------------------------------------------------------------
          const updatedSender = await tx.account.update({
            where: { id: senderAccountId! },
            data: {
              currentBalance: { decrement: transferAmount },
              updatedAt: new Date(),
            },
          });

          // ----------------------------------------------------------------
          // 6f — Negative-balance guard
          //      If two requests somehow bypassed the Redlock (e.g. Redis
          //      momentarily unavailable), SERIALIZABLE + this check catches
          //      the conflict and rolls back rather than debiting beyond zero.
          // ----------------------------------------------------------------
          if (updatedSender.currentBalance.isNegative()) {
            throw new BalanceIntegrityException(senderAccountId!);
          }

          // ----------------------------------------------------------------
          // 6e — Credit receiver
          // ----------------------------------------------------------------
          const updatedReceiver = await tx.account.update({
            where: { id: receiverAccountId! },
            data: {
              currentBalance: { increment: transferAmount },
              updatedAt: new Date(),
            },
          });

          // ----------------------------------------------------------------
          // 6g — Mark transaction SETTLED (still inside the same tx)
          // ----------------------------------------------------------------
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
        },
        {
          // SERIALIZABLE prevents phantom reads entirely.
          // Combined with FOR UPDATE this is the strongest isolation available.
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          // Give the DB transaction 15 s; the Redlock is 30 s so we'll
          // release the lock even if the commit times out.
          timeout: 15_000,
          maxWait: 5_000,
        },
      );

      const { txRecord } = committedTransaction;
      this.logger.log(
        `[UPI][${correlationId}] DB committed — txId=${txRecord.id} | status=${txRecord.status}`,
      );

      // ======================================================================
      // PHASE 7 — BLOCKCHAIN ANCHOR (Fire-and-forget)
      //
      // The payment is already settled in the database. The blockchain anchor
      // is an *audit* mechanism — it does not gate fund availability.
      //
      // We push the anchor asynchronously and update blockchainStatus via a
      // background job if the on-chain write succeeds. This keeps P99 latency
      // for the client well under 500 ms regardless of node congestion.
      // ======================================================================
      void this.anchorToBlockchainLedger(txRecord.id, txHash, correlationId);

      // ======================================================================
      // PHASE 8 — CACHE IDEMPOTENCY RESULT
      //
      // Overwrite the in-flight sentinel with the final result. Any replay
      // within the 120-second window now gets this cached response instantly
      // without touching the database.
      // ======================================================================
      const result: UpiPaymentResult = {
        success: true,
        transactionId: txRecord.id,
        rrn,
        txHash,
        blockchainStatus: 'PENDING',
        message: `Successfully transferred ${request.amount} MYSIM to ${request.receiverUpiHandle}.`,
        timestamp: new Date().toISOString(),
      };

      await this.storeIdempotencyResult(
        request.senderId,
        request.idempotencyKey,
        result,
      );

      this.logger.log(
        `[UPI][${correlationId}] ✅ Payment complete — RRN=${rrn}`,
      );
      return result;

      // ======================================================================
      // ERROR HANDLING & ROLLBACK
      // ======================================================================
    } catch (error) {
      this.logger.error(
        `[UPI][${correlationId}] ❌ Payment failed: ${error.message}`,
        error.stack,
      );

      // If a Transaction row was created before the failure, mark it
      // ROLLED_BACK so the audit trail is complete and no row is orphaned
      // in PROCESSING or PENDING state.
      if (pendingTransactionId) {
        await this.markTransactionRolledBack(
          pendingTransactionId,
          error.message,
          correlationId,
        );
      }

      // Release the idempotency sentinel so the client can retry after
      // fixing a validation error (e.g. bad amount). For in-flight conflicts
      // we intentionally leave the sentinel so the winning thread finishes.
      if (!(error instanceof RequestInFlightException)) {
        await this.clearIdempotencySentinel(
          request.senderId,
          request.idempotencyKey,
        );
      }

      // Re-throw NestJS HTTP exceptions as-is (they carry the right status).
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof UnprocessableEntityException ||
        error instanceof InsufficientFundsException ||
        error instanceof RequestInFlightException
      ) {
        throw error;
      }

      // Classify infrastructure errors to give the client actionable guidance.
      throw this.classifyAndWrapError(error);
    } finally {
      // ======================================================================
      // CLEANUP — Release distributed locks unconditionally.
      // The `finally` block runs even if `return` is hit in the try block,
      // so locks are always released regardless of success or failure path.
      // ======================================================================
      if (acquiredLocks.length > 0) {
        await this.releaseAllLocks(acquiredLocks, correlationId);
      }
    }
  }

  // ==========================================================================
  // PRIVATE — IDEMPOTENCY HELPERS
  // ==========================================================================

  /**
   * Build the Redis key for a completed idempotency result.
   * Scoped to userId so two users can't collide on the same UUID.
   */
  private idempotencyResultKey(userId: string, idemKey: string): string {
    return `idem:result:${userId}:${idemKey}`;
  }

  /** Build the Redis key for the in-flight sentinel. */
  private idempotencySentinelKey(userId: string, idemKey: string): string {
    return `idem:inflight:${userId}:${idemKey}`;
  }

  /**
   * Look up a previously stored idempotency result.
   * Returns the parsed result object, or `null` if not found.
   */
  private async lookupIdempotencyResult(
    userId: string,
    idemKey: string,
  ): Promise<UpiPaymentResult | null> {
    const raw = await this.redis.get(this.idempotencyResultKey(userId, idemKey));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UpiPaymentResult;
    } catch {
      this.logger.warn(
        `[IDEMPOTENCY] Corrupted cache entry for key ${idemKey}; ignoring.`,
      );
      return null;
    }
  }

  /**
   * Atomically place an "in-flight" sentinel in Redis.
   *
   * Uses SET NX (only set if not exists) so exactly one concurrent caller
   * wins. The short TTL ensures the sentinel auto-expires if the process
   * crashes mid-flight, preventing the key from blocking future retries.
   *
   * @returns `true` if *this* caller placed the sentinel, `false` if another
   *          thread already holds it.
   */
  private async acquireIdempotencySentinel(
    userId: string,
    idemKey: string,
  ): Promise<boolean> {
    const sentinel: IdempotencySentinel = {
      status: 'processing',
      startedAt: new Date().toISOString(),
    };
    return this.redis.set(
      this.idempotencySentinelKey(userId, idemKey),
      JSON.stringify(sentinel),
      'EX',
      IDEMPOTENCY_INFLIGHT_TTL_SEC,
      'NX',
    );
  }

  /**
   * Overwrite whatever is in Redis with the final payment result.
   * We write to the *result* key (longer TTL) and delete the sentinel.
   */
  private async storeIdempotencyResult(
    userId: string,
    idemKey: string,
    result: UpiPaymentResult,
  ): Promise<void> {
    await this.redis.setex(
      this.idempotencyResultKey(userId, idemKey),
      IDEMPOTENCY_RESULT_TTL_SEC,
      JSON.stringify(result),
    );
    // The sentinel's job is done; clean it up proactively.
    await this.redis
      .del(this.idempotencySentinelKey(userId, idemKey))
      .catch(() => {
        /* non-critical; TTL will clean it up anyway */
      });
  }

  /** Remove the sentinel on a failed request so retries aren't blocked. */
  private async clearIdempotencySentinel(
    userId: string,
    idemKey: string,
  ): Promise<void> {
    await this.redis
      .del(this.idempotencySentinelKey(userId, idemKey))
      .catch(() => {
        /* ignore; TTL covers us */
      });
  }

  // ==========================================================================
  // PRIVATE — DISTRIBUTED LOCK HELPERS
  // ==========================================================================

  /**
   * Sort account IDs lexicographically to derive a consistent lock-acquisition
   * order. This eliminates the classic deadlock pattern where:
   *   Thread A locks account X then waits for Y
   *   Thread B locks account Y then waits for X
   * With sorted keys, both threads always try X before Y, so one blocks
   * immediately instead of forming a cycle.
   */
  private sortedLockKeys(accountIdA: string, accountIdB: string): string[] {
    return [accountIdA, accountIdB].sort();
  }

  /**
   * Acquire distributed locks on all provided keys, sequentially in order.
   *
   * Busy-waits up to `LOCK_ACQUIRE_TIMEOUT_MS` for each key. If any lock
   * cannot be obtained within the timeout, all already-acquired locks are
   * released atomically before throwing.
   *
   * @returns List of lock keys that were acquired (used for cleanup).
   */
  private async acquireLocksWithTimeout(
    keys: string[],
    correlationId: string,
  ): Promise<string[]> {
    const acquired: string[] = [];
    const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;

    for (const key of keys) {
      const lockKey = `lock:account:${key}`;
      let gotLock = false;

      while (Date.now() < deadline) {
        const ok = await this.redis.set(
          lockKey,
          correlationId, // Value = who holds the lock (for debugging)
          'EX',
          LOCK_TTL_SEC,
          'NX',
        );
        if (ok) {
          acquired.push(lockKey);
          gotLock = true;
          this.logger.debug(`[LOCK][${correlationId}] Acquired ${lockKey}`);
          break;
        }
        // Back off before retrying
        await this.sleep(LOCK_RETRY_INTERVAL_MS);
      }

      if (!gotLock) {
        // Timed out — release whatever we already grabbed and surface error
        await this.releaseAllLocks(acquired, correlationId);
        throw new ConflictException(
          'The account is busy with another transaction. Please retry in a moment.',
        );
      }
    }

    return acquired;
  }

  /** Release all provided lock keys. Logs but never throws — called from `finally`. */
  private async releaseAllLocks(
    lockKeys: string[],
    correlationId: string,
  ): Promise<void> {
    for (const lockKey of lockKeys) {
      try {
        await this.redis.del(lockKey);
        this.logger.debug(`[LOCK][${correlationId}] Released ${lockKey}`);
      } catch (err) {
        this.logger.warn(
          `[LOCK][${correlationId}] Failed to release ${lockKey}: ${err.message}`,
        );
      }
    }
  }

  // ==========================================================================
  // PRIVATE — SELECT FOR UPDATE (Row-Level Locking)
  // ==========================================================================

  /**
   * Lock both Account rows at the PostgreSQL row level and return their
   * current state within the calling Prisma transaction.
   *
   * WHY RAW SQL?
   *   Prisma's ORM layer does not expose SELECT … FOR UPDATE via its fluent
   *   API (as of Prisma 5.x). We use `$queryRaw` with a tagged template
   *   literal, which is parameterised by Prisma and safe from SQL injection.
   *
   * The FOR UPDATE clause tells PostgreSQL:
   *   "Lock these rows exclusively. Any other transaction that attempts to
   *    SELECT FOR UPDATE or UPDATE these rows will block until we commit or
   *    roll back."
   *
   * NOWAIT is intentionally *not* used here because we already hold the
   * Redlock — a competing DB transaction on the same rows should be rare
   * and brief (i.e. a long-running analytics query, not another payment).
   *
   * @param tx   The active Prisma interactive transaction client.
   * @param senderAccountId
   * @param receiverAccountId
   */
  private async lockAccountRows(
    tx: Prisma.TransactionClient,
    senderAccountId: string,
    receiverAccountId: string,
  ): Promise<[LockedAccountRow, LockedAccountRow]> {
    // Fetching both rows in a single query minimises round-trips.
    const rows = await tx.$queryRaw<LockedAccountRow[]>`
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
      throw new BadRequestException(
        'One or both accounts could not be found for locking.',
      );
    }

    // The query returns rows in arbitrary order — pin them by ID.
    const sender = rows.find((r) => r.id === senderAccountId);
    const receiver = rows.find((r) => r.id === receiverAccountId);

    if (!sender || !receiver) {
      throw new BadRequestException(
        'Failed to identify sender or receiver account in locked result set.',
      );
    }

    return [sender, receiver];
  }

  // ==========================================================================
  // PRIVATE — ACCOUNT RESOLUTION
  // ==========================================================================

  private async resolveSenderAccount(
    senderId: string,
  ): Promise<{ id: string; currency: string }> {
    const account = await this.prisma.account.findFirst({
      where: { userId: senderId, status: 'ACTIVE' },
      select: { id: true, currency: true },
    });
    if (!account) {
      throw new BadRequestException(
        `No active account found for sender ${senderId}.`,
      );
    }
    return account;
  }

  private async resolveReceiverAccount(
    upiHandle: string,
    senderId: string,
  ): Promise<{ accountId: string; userId: string }> {
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
      throw new BadRequestException(
        `UPI handle not found: ${upiHandle}`,
      );
    }

    if (user.id === senderId) {
      throw new BadRequestException(
        'Self-transfers are not permitted.',
      );
    }

    if (!user.accounts.length) {
      throw new BadRequestException(
        `Receiver ${upiHandle} has no active account to receive funds.`,
      );
    }

    return { accountId: user.accounts[0].id, userId: user.id };
  }

  // ==========================================================================
  // PRIVATE — BLOCKCHAIN ANCHOR
  // ==========================================================================

  /**
   * Push the settled transaction hash to the BankingAuditLedger smart
   * contract. This is intentionally fire-and-forget — the payment is already
   * settled in PostgreSQL; the blockchain is a tamper-evident audit log, not
   * the source of truth.
   *
   * On success: creates a BlockchainAuditLog row and updates the Transaction's
   *             blockchainStatus → ANCHORED.
   * On failure: logs the error, updates blockchainStatus → FAILED, and
   *             schedules a retry via the AsyncJob queue.
   *
   * Both paths preserve the settled Transaction; neither triggers a rollback.
   */
  private async anchorToBlockchainLedger(
    transactionId: string,
    txHash: string,
    correlationId: string,
  ): Promise<void> {
    this.logger.log(
      `[BLOCKCHAIN][${correlationId}] Anchoring txId=${transactionId} hash=${txHash.slice(0, 18)}…`,
    );

    try {
      // -----------------------------------------------------------------------
      // MOCK FUNCTION CALL — replace with real blockchain.anchorTransaction()
      // in production once the contract is deployed.
      //
      // Simulation matches the real BlockchainService.anchorTransaction() ABI:
      //   anchorTransaction(bytes32 txHash, bytes32 previousHash,
      //                     address sender, address receiver,
      //                     uint256 amountWei, uint256 timestamp)
      // -----------------------------------------------------------------------
      const anchorResult = await this.mockBlockchainAnchor(
        transactionId,
        txHash,
      );
      // -----------------------------------------------------------------------

      // Persist audit record regardless of mock/live path
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

      this.logger.log(
        `[BLOCKCHAIN][${correlationId}] ✅ Anchored — block=${anchorResult.blockNumber} | onChainTxId=${anchorResult.onChainTxId}`,
      );
    } catch (err) {
      this.logger.error(
        `[BLOCKCHAIN][${correlationId}] ❌ Anchor failed: ${err.message}`,
        err.stack,
      );

      // Mark as failed; the async-job-worker will retry up to maxRetries times.
      await this.prisma.transaction
        .update({
          where: { id: transactionId },
          data: { blockchainStatus: 'FAILED' },
        })
        .catch((updateErr) => {
          this.logger.error(
            `[BLOCKCHAIN][${correlationId}] Could not mark blockchainStatus=FAILED: ${updateErr.message}`,
          );
        });

      // Enqueue a retry job so the background worker can re-attempt anchoring
      // without customer impact. The payment itself is already settled.
      await this.enqueueBlockchainRetry(transactionId, txHash, correlationId);
    }
  }

  /**
   * Mock blockchain anchor — simulates the on-chain write without a live node.
   *
   * Produces deterministic-looking output that exercises the same code paths
   * (audit log creation, status updates) as the real contract call.
   *
   * Replace this method body with:
   *   return this.blockchain.anchorTransaction(transactionId, txHash);
   * once the BankingAuditLedger contract is deployed to the target network.
   */
  private async mockBlockchainAnchor(
    transactionId: string,
    txHash: string,
  ): Promise<{ blockNumber: number; onChainTxId: string }> {
    // Simulate realistic network latency (50–200 ms)
    await this.sleep(50 + Math.random() * 150);

    const isMockEnabled =
      this.config.get<string>('MOCK_BLOCKCHAIN', 'false') === 'true' ||
      this.config.get<string>('NODE_ENV') !== 'production';

    if (!isMockEnabled) {
      // In production with MOCK_BLOCKCHAIN=false, delegate to the real service.
      const result = await this.blockchain.anchorTransaction(
        transactionId,
        txHash,
      );
      return {
        blockNumber: result.blockNumber,
        onChainTxId: result.txId,
      };
    }

    // Simulate a deterministic block number derived from the transaction hash
    // so log outputs are reproducible in test environments.
    const mockBlockNumber =
      19_000_000 +
      (parseInt(txHash.slice(2, 10), 16) % 999_999);

    // Simulate the on-chain transaction ID (Ethereum tx hash format)
    const mockOnChainTxId =
      '0x' +
      crypto
        .createHash('sha256')
        .update(`${transactionId}:${txHash}:${mockBlockNumber}`)
        .digest('hex');

    this.logger.debug(
      `[BLOCKCHAIN-MOCK] Simulated anchor — block=${mockBlockNumber} | onChainTx=${mockOnChainTxId.slice(0, 18)}…`,
    );

    return {
      blockNumber: mockBlockNumber,
      onChainTxId: mockOnChainTxId,
    };
  }

  /** Schedule a retry job for failed blockchain anchors via the AsyncJob table. */
  private async enqueueBlockchainRetry(
    transactionId: string,
    txHash: string,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.prisma.asyncJob.create({
        data: {
          jobType: 'SETTLEMENT_BATCH', // Closest semantic match in existing enum
          gatewayId: this.config.get<string>(
            'BLOCKCHAIN_GATEWAY_ID',
            'blockchain-default',
          ),
          transactionId,
          referenceId: `bc-retry:${transactionId}:${Date.now()}`,
          payload: JSON.stringify({ transactionId, txHash, correlationId }),
          status: 'PENDING',
          maxRetries: 5,
          nextRetryAt: new Date(Date.now() + 60_000), // First retry in 60 s
        },
      });
      this.logger.log(
        `[BLOCKCHAIN][${correlationId}] Retry job enqueued for txId=${transactionId}`,
      );
    } catch (err) {
      // Non-fatal: the FAILED status on the Transaction row is enough for
      // an ops team to reconcile manually if the job queue is also down.
      this.logger.error(
        `[BLOCKCHAIN][${correlationId}] Could not enqueue retry job: ${err.message}`,
      );
    }
  }

  // ==========================================================================
  // PRIVATE — ERROR HANDLING HELPERS
  // ==========================================================================

  /**
   * Attempt to mark a Transaction as ROLLED_BACK.
   * Called from the catch block; must never throw (it's defensive).
   */
  private async markTransactionRolledBack(
    transactionId: string,
    reason: string,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: {
          status: 'ROLLED_BACK',
          errorReason: reason.substring(0, 500),
        },
      });
      this.logger.warn(
        `[ROLLBACK][${correlationId}] Marked txId=${transactionId} as ROLLED_BACK.`,
      );
    } catch (err) {
      this.logger.error(
        `[ROLLBACK][${correlationId}] ⚠️  Could not mark transaction ROLLED_BACK: ${err.message}. ` +
          `Manual reconciliation required for txId=${transactionId}.`,
      );
    }
  }

  /**
   * Classify infrastructure errors into retryable vs. non-retryable and
   * return an appropriate HTTP exception.
   */
  private classifyAndWrapError(
    error: Error,
  ): InternalServerErrorException {
    const retryablePatterns = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'connect ETIMEDOUT',
      'Too many connections',
      'deadlock detected',       // Prisma wraps this from PG
      'P2034',                   // Prisma transaction conflict code
    ];

    const isRetryable = retryablePatterns.some((pattern) =>
      error.message.includes(pattern),
    );

    return new InternalServerErrorException(
      isRetryable
        ? 'A temporary infrastructure error occurred. Please retry your request.'
        : 'Payment processing failed. Please contact support if the issue persists.',
    );
  }

  // ==========================================================================
  // PRIVATE — INPUT VALIDATION
  // ==========================================================================

  /**
   * Validate all fields of the incoming request before any I/O.
   * Throws `BadRequestException` on the first violation.
   */
  private validateRequest(request: UpiPaymentRequest): void {
    if (!this.isValidUuidV4(request.senderId)) {
      throw new BadRequestException('Invalid senderId — expected UUIDv4.');
    }

    if (!this.isValidUuidV4(request.idempotencyKey)) {
      throw new BadRequestException(
        'Invalid X-Idempotency-Key — expected UUIDv4.',
      );
    }

    const upiPattern = /^[a-zA-Z0-9._-]{3,50}@mybank$/;
    if (!upiPattern.test(request.receiverUpiHandle)) {
      throw new BadRequestException(
        'Invalid receiver UPI handle. Expected format: username@mybank (3-50 alphanumeric chars).',
      );
    }

    const amount = Number(request.amount);
    if (!Number.isFinite(amount) || amount < MIN_TRANSFER_AMOUNT) {
      throw new BadRequestException(
        `Amount must be a positive number ≥ ${MIN_TRANSFER_AMOUNT}.`,
      );
    }
    if (amount > MAX_TRANSFER_AMOUNT) {
      throw new BadRequestException(
        `Amount exceeds the per-transaction ceiling of ${MAX_TRANSFER_AMOUNT} MYSIM.`,
      );
    }

    const decimalPart = (amount.toString().split('.')[1] ?? '').length;
    if (decimalPart > MAX_DECIMAL_PLACES) {
      throw new BadRequestException(
        `Amount must have at most ${MAX_DECIMAL_PLACES} decimal places.`,
      );
    }

    if (!request.description?.trim()) {
      throw new BadRequestException('Description is required.');
    }
    if (request.description.length > 500) {
      throw new BadRequestException('Description must not exceed 500 characters.');
    }
  }

  // ==========================================================================
  // PRIVATE — CRYPTOGRAPHIC / ID GENERATION UTILITIES
  // ==========================================================================

  /**
   * Generate a UPI Reference Reference Number.
   * Format: YYYY + Julian day (3 digits) + 6 uppercase hex random chars.
   * Example: 2025143A3F9C1D
   */
  private generateRrn(): string {
    const now = new Date();
    const year = now.getFullYear().toString();
    const start = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor(
      (now.getTime() - start.getTime()) / 86_400_000,
    )
      .toString()
      .padStart(3, '0');
    const random = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${year}${dayOfYear}${random}`;
  }

  /**
   * Generate a deterministic SHA-256 transaction hash.
   *
   * The hash encodes senderId, receiverId, amount, RRN, idempotencyKey,
   * and timestamp so it is unique per payment and tamper-evident.
   * The same inputs always produce the same hash, which is important for
   * idempotent blockchain re-submission.
   */
  private generateTxHash(params: {
    senderId: string;
    receiverId: string;
    amount: string;
    rrn: string;
    idempotencyKey: string;
    timestamp: string;
  }): string {
    const preimage = [
      params.senderId,
      params.receiverId,
      params.amount,
      params.rrn,
      params.idempotencyKey,
      params.timestamp,
    ].join(':');

    return (
      '0x' + crypto.createHash('sha256').update(preimage).digest('hex')
    );
  }

  private isValidUuidV4(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
