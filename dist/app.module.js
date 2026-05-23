"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const jwt_1 = require("@nestjs/jwt");
const prisma_service_1 = require("./prisma.service");
const redis_service_1 = require("./redis.service");
const blockchain_service_1 = require("./blockchain.service");
const transfer_service_1 = require("./transfer.service");
const upi_payment_service_1 = require("./upi-payment.service");
const authentication_service_1 = require("./authentication.service");
const async_job_worker_service_1 = require("./async-job-worker.service");
const websocket_gateway_1 = require("./websocket.gateway");
const transfer_controller_1 = require("./transfer.controller");
const auth_controller_1 = require("./auth.controller");
const health_controller_1 = require("./health.controller");
const accounts_controller_1 = require("./accounts.controller");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                envFilePath: ['.env.local', '.env'],
            }),
            jwt_1.JwtModule.registerAsync({
                global: true,
                inject: [config_1.ConfigService],
                useFactory: async (config) => ({
                    secret: config.get('JWT_SECRET'),
                    signOptions: { expiresIn: '60m' },
                }),
            }),
        ],
        controllers: [health_controller_1.HealthController, transfer_controller_1.TransferController, auth_controller_1.AuthController, accounts_controller_1.AccountsController],
        providers: [
            prisma_service_1.PrismaService,
            redis_service_1.RedisService,
            blockchain_service_1.BlockchainService,
            transfer_service_1.TransferService,
            upi_payment_service_1.UpiPaymentService,
            authentication_service_1.AuthenticationService,
            async_job_worker_service_1.AsyncJobWorkerService,
            websocket_gateway_1.TransactionWebSocketGateway,
            websocket_gateway_1.WebSocketBroadcastService,
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map