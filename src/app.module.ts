import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from './database/database.module';
import { UserModule } from './modules/user/user.module';
import { DealModule } from './modules/deal/deal.module';
import { IntentModule } from './modules/intent/intent.module';
import { ContractModule } from './modules/contract/contract.module';
import { TonModule } from './modules/ton/ton.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ArbitrationModule } from './modules/arbitration/arbitration.module';
import { DisputeModule } from './modules/dispute/dispute.module';
import { QueueModule } from './modules/queue/queue.module';
import { BotModule } from './modules/bot/bot.module';
import { NotificationModule } from './modules/notification/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    DatabaseModule,
    UserModule,
    DealModule,
    IntentModule,
    ContractModule,
    TonModule,
    PaymentModule,
    ArbitrationModule,
    DisputeModule,
    QueueModule,
    BotModule,
    NotificationModule,
  ],
})
export class AppModule {}
