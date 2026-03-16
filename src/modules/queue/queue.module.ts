import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueService } from './queue.service';
import { PaymentProcessor } from './processors/payment.processor';
import { PAYMENT_QUEUE } from './queue.constants';
import { PaymentModule } from '../payment/payment.module';
import { DealModule } from '../deal/deal.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: PAYMENT_QUEUE }),
    PaymentModule,
    DealModule,
    forwardRef(() => NotificationModule),
  ],
  providers: [QueueService, PaymentProcessor],
  exports: [QueueService],
})
export class QueueModule {}