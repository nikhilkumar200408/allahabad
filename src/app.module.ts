import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

// Services
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { BlockchainService } from './blockchain.service';
import { TransferService } from './transfer.service';
import { UpiPaymentService } from './upi-payment.service';
import { AuthenticationService } from './authentication.service';
import { AsyncJobWorkerService } from './async-job-worker.service';
import {
  TransactionWebSocketGateway,
  WebSocketBroadcastService,
} from './websocket.gateway';

// Controllers
import { TransferController } from './transfer.controller';
import { AuthController } from './auth.controller';
import { HealthController } from './health.controller';
import { AccountsController } from './accounts.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '60m' },
      }),
    }),
  ],
  controllers: [HealthController, TransferController, AuthController, AccountsController],
  providers: [
    PrismaService,
    RedisService,
    BlockchainService,
    TransferService,
    UpiPaymentService,
    AuthenticationService,
    AsyncJobWorkerService,
    TransactionWebSocketGateway,
    WebSocketBroadcastService,
  ],
})
export class AppModule {}
