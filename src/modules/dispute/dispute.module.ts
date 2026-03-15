import { Module } from '@nestjs/common';
import { DisputeService } from './dispute.service';
import { ArbitrationModule } from '../arbitration/arbitration.module';
import { PaymentModule } from '../payment/payment.module';
import { DealModule } from '../deal/deal.module';

@Module({
  imports: [ArbitrationModule, PaymentModule, DealModule],
  providers: [DisputeService],
  exports: [DisputeService],
})
export class DisputeModule {}
