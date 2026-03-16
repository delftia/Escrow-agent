import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PAYMENT_QUEUE } from '../queue.constants';
import { PaymentService } from '../../payment/payment.service';
import { DealService } from '../../deal/deal.service';
import { NotificationService } from '../../notification/notification.service';

@Processor(PAYMENT_QUEUE)
export class PaymentProcessor {
  private readonly logger = new Logger(PaymentProcessor.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly dealService: DealService,
    private readonly notificationService: NotificationService,
  ) {}

  @Process('verify-payment')
  async verifyPayment(job: Job<{ dealId: string }>): Promise<void> {
    const { dealId } = job.data;
    this.logger.log(`Polling payment for deal ${dealId} (attempt ${job.attemptsMade + 1})`);

    const confirmed = await this.paymentService.verifyPayment(dealId);

    if (!confirmed) {
      // Throw to trigger retry
      throw new Error(`Payment not yet found for deal ${dealId}`);
    }

    // Payment confirmed → update deal + notify both parties
    await this.dealService.markPaid(dealId);
    await this.notificationService.onPaymentConfirmed(dealId);

    this.logger.log(`Payment confirmed and deal activated: ${dealId}`);
  }
}
