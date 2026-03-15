import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueService } from './queue.service';
import { PaymentProcessor } from './processors/payment.processor';
import { PaymentModule } from '../payment/payment.module';
import { DealModule } from '../deal/deal.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'payment' }),
    PaymentModule,
    DealModule,
  ],
  providers: [QueueService, PaymentProcessor],
  exports: [QueueService],
})
export class QueueModule {}
