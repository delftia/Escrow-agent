import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PaymentService } from '../../payment/payment.service';
import { DealService } from '../../deal/deal.service';
import { PrismaService } from '../../../database/prisma.service';

@Processor('payment')
export class PaymentProcessor {
  private readonly logger = new Logger(PaymentProcessor.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly dealService: DealService,
    private readonly prisma: PrismaService,
  ) {}

  @Process('verify-payment')
  async verifyPayment(job: Job<{ dealId: string }>): Promise<void> {
    const { dealId } = job.data;
    this.logger.log(`Polling payment for deal ${dealId} (attempt ${job.attemptsMade + 1})`);

    const confirmed = await this.paymentService.verifyPayment(dealId);
    if (!confirmed) {
      throw new Error(`Payment not yet found for deal ${dealId}`);
    }

    await this.dealService.markPaid(dealId);
    this.logger.log(`Payment confirmed and deal activated: ${dealId}`);
  }
}
