import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PAYMENT_QUEUE } from './queue.constants';

import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(PAYMENT_QUEUE) private readonly paymentQueue: Queue,
  ) {}

  async schedulePaymentVerification(dealId: string): Promise<void> {
    try {
      await this.paymentQueue.add(
        'verify-payment',
        { dealId },
        {
          delay: 15_000,
          attempts: 60,
          backoff: {
            type: 'fixed',
            delay: 15_000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );

      this.logger.log(`Scheduled payment verification for deal ${dealId}`);
    } catch (err) {
      this.logger.error(`Failed to enqueue payment verification for deal ${dealId}`, err);
      throw err;
    }
  }
}