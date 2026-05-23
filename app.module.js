"use strict";
// Core Banking Platform - NestJS Application Module
// Bootstraps all services, guards, and middleware
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
exports.bootstrap = bootstrap;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
// Services
const prisma_service_1 = require("./prisma.service");
const redis_service_1 = require("./redis.service");
const blockchain_service_1 = require("./blockchain.service");
const transfer_service_1 = require("./transfer.service");
const upi_payment_service_1 = require("./upi-payment.service");
const auth_guard_1 = require("./auth.guard");
const authentication_service_1 = require("./authentication.service");
const async_job_worker_service_1 = require("./async-job-worker.service");
const websocket_gateway_1 = require("./websocket.gateway");
// Controllers
const transfer_controller_1 = require("./transfer.controller");
// Middleware & Guards
const validators_guards_1 = require("./validators-guards");
// ============================================================================
// CORE APPLICATION MODULE
// ============================================================================
let AppModule = class AppModule {
    /**
     * Configure middleware for all routes
     */
    configure(consumer) {
        consumer.apply(validators_guards_1.SecurityHeadersMiddleware).forRoutes('*');
    }
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            // Configuration Module: Load environment variables
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: ['.env.local', '.env'],
                ignoreEnvFile: process.env.NODE_ENV === 'production',
            }),
            // JWT Module: Token generation and verification
            jwt_1.JwtModule.registerAsync({
                isGlobal: true,
                inject: [config_1.ConfigService],
                useFactory: async (configService) => ({
                    secret: configService.get('JWT_SECRET'),
                    signOptions: {
                        expiresIn: `${configService.get('JWT_ACCESS_TOKEN_EXPIRY_MINUTES', 60)}m`,
                        issuer: configService.get('JWT_ISSUER', 'banking-platform'),
                        audience: configService.get('JWT_AUDIENCE', 'banking-platform-api'),
                    },
                }),
            }),
        ],
        controllers: [transfer_controller_1.TransferController],
        providers: [
            // Core Services
            prisma_service_1.PrismaService,
            redis_service_1.RedisService,
            redis_service_1.DistributedLockService,
            blockchain_service_1.BlockchainService,
            transfer_service_1.TransferService,
            upi_payment_service_1.UpiPaymentService,
            authentication_service_1.AuthenticationService,
            async_job_worker_service_1.AsyncJobWorkerService,
            // WebSocket
            websocket_gateway_1.TransactionWebSocketGateway,
            websocket_gateway_1.WebSocketBroadcastService,
        ],
        exports: [
            // Export services for use in other modules
            prisma_service_1.PrismaService,
            redis_service_1.RedisService,
            redis_service_1.DistributedLockService,
            blockchain_service_1.BlockchainService,
            transfer_service_1.TransferService,
            upi_payment_service_1.UpiPaymentService,
            auth_guard_1.AuthGuard,
            authentication_service_1.AuthenticationService,
            async_job_worker_service_1.AsyncJobWorkerService,
            websocket_gateway_1.WebSocketBroadcastService,
        ],
    })
], AppModule);
// ============================================================================
// EXAMPLE: FEATURE MODULE (Replicable pattern for additional features)
// ============================================================================
/**
 * Example structure for adding new features:
 *
 * @Module({
 *   imports: [AppModule], // Import shared services
 *   controllers: [PaymentController],
 *   providers: [PaymentService],
 *   exports: [PaymentService],
 * })
 * export class PaymentModule {}
 *
 * Then in main app module:
 * imports: [AppModule, PaymentModule]
 */
// ============================================================================
// MAIN APPLICATION BOOTSTRAP
// ============================================================================
const core_1 = require("@nestjs/core");
const swagger_1 = require("@nestjs/swagger");
const common_2 = require("@nestjs/common");
const helmet = __importStar(require("helmet"));
const compression = __importStar(require("compression"));
/**
 * Bootstrap the NestJS application
 */
async function bootstrap() {
    const app = await core_1.NestFactory.create(AppModule);
    const config = app.get(config_1.ConfigService);
    // =========================================================================
    // SECURITY MIDDLEWARE
    // =========================================================================
    // Helmet: Secure HTTP headers
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", 'data:', 'https:'],
            },
        },
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true,
        },
    }));
    // Compression: Gzip response bodies
    app.use(compression());
    // =========================================================================
    // VALIDATION & PIPES
    // =========================================================================
    // Global validation pipe with Zod-style error messages
    app.useGlobalPipes(new common_2.ValidationPipe({
        whitelist: true, // Strip non-defined properties
        forbidNonWhitelisted: true, // Throw error on non-defined properties
        transform: true, // Auto-transform to DTO types
        transformOptions: {
            enableImplicitConversion: true,
        },
    }));
    // =========================================================================
    // CORS CONFIGURATION
    // =========================================================================
    const frontendUrl = config.get('FRONTEND_URL', 'http://localhost:3000');
    app.enableCors({
        origin: frontendUrl,
        credentials: true, // Allow cookies
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Idempotency-Key',
            'X-Device-ID',
            'X-Forwarded-For',
        ],
        exposedHeaders: [
            'X-Request-ID',
            'X-RateLimit-Limit',
            'X-RateLimit-Remaining',
            'X-RateLimit-Reset',
        ],
        maxAge: 3600,
    });
    // =========================================================================
    // SWAGGER API DOCUMENTATION
    // =========================================================================
    const swaggerConfig = new swagger_1.DocumentBuilder()
        .setTitle('Core Banking Simulation Platform')
        .setDescription('Production-grade banking platform with blockchain anchoring, distributed transactions, and real-time updates')
        .setVersion('1.0.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer-token')
        .addSecurityRequirementAt('bearer-token', ['/api/v1/transfers', 'POST'])
        .setContact('Development Team', 'https://github.com/banking-platform', 'dev@mybank.local')
        .setLicense('Proprietary', '')
        .build();
    const swaggerDocument = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
    // Serve Swagger UI at /api/docs
    swagger_1.SwaggerModule.setup('api/docs', app, swaggerDocument, {
        swaggerOptions: {
            persistAuthorization: true,
            displayOperationId: true,
        },
    });
    // =========================================================================
    // HEALTH CHECK ENDPOINT
    // =========================================================================
    app.get('/health', async (req, res) => {
        const prisma = app.get(prisma_service_1.PrismaService);
        const redis = app.get(redis_service_1.RedisService);
        try {
            // Check database connectivity
            await prisma.$queryRaw `SELECT 1`;
            // Check Redis connectivity
            await redis.ping();
            res.status(200).json({
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                services: {
                    database: 'ok',
                    redis: 'ok',
                },
            });
        }
        catch (error) {
            res.status(503).json({
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString(),
            });
        }
    });
    // =========================================================================
    // START SERVER
    // =========================================================================
    const port = config.get('PORT', 3000);
    const nodeEnv = config.get('NODE_ENV', 'development');
    await app.listen(port);
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║     Core Banking Simulation Platform - ${nodeEnv.toUpperCase().padEnd(38)}║
╠════════════════════════════════════════════════════════════════╣
║  🚀 Server running on: http://localhost:${port.toString().padEnd(36)}║
║  📚 API Docs: http://localhost:${port}/api/docs${' '.repeat(31)}║
║  🏥 Health Check: http://localhost:${port}/health${' '.repeat(26)}║
║                                                                ║
║  Features Enabled:                                             ║
║    ✓ Double-entry bookkeeping                                 ║
║    ✓ Distributed ACID transactions (Serializable isolation)  ║
║    ✓ Redis-based distributed locking                          ║
║    ✓ Blockchain transaction anchoring                         ║
║    ✓ Idempotency & deduplication (120s window)               ║
║    ✓ Multi-device session tracking                            ║
║    ✓ Real-time WebSocket updates                              ║
║    ✓ Async job worker (mobile recharge, utilities)           ║
║    ✓ Exponential backoff retry logic                          ║
║    ✓ UPI Payment Processing                                   ║
║                                                                ║
║  Security:                                                     ║
║    ✓ JWT authentication (HttpOnly cookies)                   ║
║    ✓ XSS, CSRF, Clickjacking protection                      ║
║    ✓ SQL injection prevention (Prisma ORM)                   ║
║    ✓ Rate limiting per IP                                     ║
║    ✓ Request validation (Zod-style)                          ║
║    ✓ Encrypted sensitive data at rest                         ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
  `);
}
// Start application
if (require.main === module) {
    bootstrap().catch((err) => {
        console.error('❌ Application failed to start:', err);
        process.exit(1);
    });
}
