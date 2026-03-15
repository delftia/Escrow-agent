import { Module } from '@nestjs/common';
import { PaymentService } from './payment.service';
import { TonModule } from '../ton/ton.module';

@Module({
  imports: [TonModule],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
