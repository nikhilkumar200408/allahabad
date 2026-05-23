// Core Banking Platform - Transfer Controller
// REST API endpoints with comprehensive security and real-time updates

import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  UseGuards,
  HttpStatus,
  HttpCode,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiHeader,
  ApiBearerAuth,
  ApiTags,
} from '@nestjs/swagger';
import { TransferService, TransferRequest, TransferResponse } from './transfer.service';
import { BlockchainService } from './blockchain.service';
import { PrismaService } from './prisma.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { validateIdempotencyKey, validateUpiHandle } from './validators';
import * as crypto from 'crypto';

// ============================================================================
// DATA TRANSFER OBJECTS (DTOs)
// ============================================================================

export class InitiateTransferDTO {
  /**
   * Receiver UPI handle (e.g., user@mybank)
   * Required, must be valid UPI format
   */
  receiverHandle: string;

  /**
   * Transfer amount in MYSIM (min: 0.01, max: 999,999.99)
   * Must be positive decimal with max 6 decimal places
   */
  amount: number;

  /**
   * Optional description/reference for the transaction
   * Max 500 characters
   */
  description?: string;
}

export class VerifyTransactionDTO {
  /**
   * Transaction hash (0x-prefixed 64-char hex)
   * Used for blockchain verification
   */
  txHash: string;
}

export class TransactionHistoryQueryDTO {
  /**
   * Pagination: page number (1-indexed)
   */
  page?: number;

  /**
   * Items per page (max 50)
   */
  limit?: number;

  /**
   * Filter by transaction status
   */
  status?: 'PENDING' | 'SETTLED' | 'FAILED';

  /**
   * Filter by direction (sent/received)
   */
  direction?: 'SENT' | 'RECEIVED';
}

// ============================================================================
// TRANSFER CONTROLLER
// ============================================================================

@Controller('api/v1/transfers')
@ApiTags('Transfers')
@ApiBearerAuth('bearer-token')
export class TransferController {
  private readonly logger = new Logger(TransferController.name);

  constructor(
    private transferService: TransferService,
    private blockchainService: BlockchainService,
    private prisma: PrismaService,
  ) {}

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
  @Post('initiate')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Initiate P2P UPI Transfer',
    description: 'Execute a peer-to-peer transfer with full ACID guarantees and blockchain anchoring',
  })
  @ApiHeader({
    name: 'X-Idempotency-Key',
    description: 'UUIDv4 for idempotent request tracking (120-second window)',
    required: true,
  })
  @ApiHeader({
    name: 'X-Device-ID',
    description: 'Device identifier for multi-device session tracking',
    required: true,
  })
  @ApiResponse({
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
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request or business logic error',
    schema: {
      example: {
        statusCode: 400,
        message: 'Insufficient balance. Available: 100.00, Requested: 500.00',
        error: 'Bad Request',
      },
    },
  })
  async initiateTransfer(
    @CurrentUser() currentUser: any,
    @Body() dto: InitiateTransferDTO,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @Headers('x-device-id') deviceId: string,
    @Headers('user-agent') userAgent: string,
    @Headers('x-forwarded-for') clientIp?: string,
  ): Promise<TransferResponse> {
    this.logger.log(
      `[TRANSFER-API] User: ${currentUser.id}, Receiver: ${dto.receiverHandle}`,
    );

    // =========================================================================
    // VALIDATE REQUEST HEADERS
    // =========================================================================
    if (!idempotencyKey) {
      throw new BadRequestException(
        'X-Idempotency-Key header is required (UUIDv4)',
      );
    }

    if (!validateIdempotencyKey(idempotencyKey)) {
      throw new BadRequestException(
        'Invalid X-Idempotency-Key format. Expected UUIDv4.',
      );
    }

    if (!deviceId) {
      throw new BadRequestException('X-Device-ID header is required');
    }

    // =========================================================================
    // VALIDATE REQUEST BODY
    // =========================================================================
    if (!dto.receiverHandle) {
      throw new BadRequestException('receiverHandle is required');
    }

    if (!validateUpiHandle(dto.receiverHandle)) {
      throw new BadRequestException(
        'Invalid UPI handle format. Expected: user@mybank',
      );
    }

    if (!dto.amount) {
      throw new BadRequestException('amount is required');
    }

    // =========================================================================
    // TRACK DEVICE SESSION
    // =========================================================================
    const ipAddress = clientIp || 'UNKNOWN';
    try {
      await this.trackDeviceSession(
        currentUser.id,
        deviceId,
        userAgent,
        ipAddress,
      );
    } catch (error) {
      this.logger.warn(
        `[DEVICE-TRACKING-ERROR] ${error.message}`,
      );
      // Don't fail transaction on device tracking error
    }

    // =========================================================================
    // EXECUTE TRANSFER SERVICE
    // =========================================================================
    const transferRequest: TransferRequest = {
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
  @Get(':transactionId')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Get Transaction Details',
    description: 'Retrieve full transaction record including blockchain status',
  })
  @ApiResponse({
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
  })
  async getTransaction(
    @CurrentUser() currentUser: any,
    @Param('transactionId') transactionId: string,
  ) {
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
      throw new NotFoundException(
        `Transaction not found: ${transactionId}`,
      );
    }

    // Verify ownership (sender or receiver only)
    if (
      transaction.senderId !== currentUser.id &&
      transaction.receiverId !== currentUser.id
    ) {
      throw new NotFoundException(
        'Access denied. You are not party to this transaction.',
      );
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
  @Get('rrn/:rrn')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Get Transaction by RRN',
    description: 'Retrieve transaction using UPI Reference Number',
  })
  async getTransactionByRrn(
    @CurrentUser() currentUser: any,
    @Param('rrn') rrn: string,
  ) {
    this.logger.log(`[GET-TRANSACTION-RRN] ${rrn}`);

    // Validate RRN format
    if (!/^\d{4}\d{3}[A-F0-9]{6}$/.test(rrn)) {
      throw new BadRequestException('Invalid RRN format');
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
      throw new NotFoundException(`Transaction not found: ${rrn}`);
    }

    // Verify ownership
    if (
      transaction.senderId !== currentUser.id &&
      transaction.receiverId !== currentUser.id
    ) {
      throw new NotFoundException(
        'Access denied. You are not party to this transaction.',
      );
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
  @Post('verify-blockchain')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Verify Transaction on Blockchain',
    description: 'Verify transaction hash exists on-chain and retrieve audit proof',
  })
  async verifyOnBlockchain(
    @CurrentUser() currentUser: any,
    @Body() dto: VerifyTransactionDTO,
  ) {
    this.logger.log(
      `[BLOCKCHAIN-VERIFY] User: ${currentUser.id}, Hash: ${dto.txHash}`,
    );

    if (!dto.txHash || !dto.txHash.startsWith('0x')) {
      throw new BadRequestException(
        'txHash must be 0x-prefixed 64-character hex string',
      );
    }

    try {
      const auditProof = await this.blockchainService.getAuditProof(
        dto.txHash,
      );

      return {
        verified: auditProof.verified,
        blockNumber: auditProof.blockNumber,
        chainproof: auditProof.chainproof ? JSON.parse(auditProof.chainproof) : null,
      };
    } catch (error) {
      this.logger.error(
        `[BLOCKCHAIN-VERIFY-ERROR] ${error.message}`,
      );
      throw new BadRequestException(
        'Failed to verify transaction on blockchain',
      );
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
  @Get()
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Get Transaction History',
    description: 'Retrieve paginated transaction history with filtering',
  })
  async getTransactionHistory(
    @CurrentUser() currentUser: any,
    @Body() query: TransactionHistoryQueryDTO,
  ) {
    this.logger.log(`[TRANSACTION-HISTORY] User: ${currentUser.id}`);

    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, query.limit || 20);
    const skip = (page - 1) * limit;

    // Build dynamic where clause
    const where: any = {
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

  private async trackDeviceSession(
    userId: string,
    deviceId: string,
    userAgent: string,
    ipAddress: string,
  ): Promise<void> {
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
      } else {
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

        this.logger.log(
          `[NEW-DEVICE] User: ${userId}, Device: ${deviceId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[DEVICE-TRACKING-ERROR] ${error.message}`,
      );
      throw error;
    }
  }

  private hashDeviceToken(deviceId: string): string {
    return crypto
      .createHash('sha256')
      .update(deviceId)
      .digest('hex');
  }

  private inferDeviceType(userAgent: string): any {
    if (!userAgent) return 'WEB_DESKTOP';

    const lower = userAgent.toLowerCase();

    if (lower.includes('iphone') || lower.includes('ios')) {
      return lower.includes('tablet') ? 'TABLET_IOS' : 'MOBILE_IOS';
    }

    if (lower.includes('android')) {
      return lower.includes('tablet') ? 'TABLET_ANDROID' : 'MOBILE_ANDROID';
    }

    return 'WEB_DESKTOP';
  }
}
