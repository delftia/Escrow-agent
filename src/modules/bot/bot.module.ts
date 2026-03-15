import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { BotUpdate } from './bot.update';
import { UserModule } from '../user/user.module';
import { DealModule } from '../deal/deal.module';
import { IntentModule } from '../intent/intent.module';
import { ContractModule } from '../contract/contract.module';
import { PaymentModule } from '../payment/payment.module';
import { DisputeModule } from '../dispute/dispute.module';
import { ArbitrationModule } from '../arbitration/arbitration.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    UserModule,
    DealModule,
    IntentModule,
    ContractModule,
    PaymentModule,
    ArbitrationModule,
    DisputeModule,
    QueueModule,
  ],
  providers: [BotService, BotUpdate],
  exports: [BotService],
})
export class BotModule {}
