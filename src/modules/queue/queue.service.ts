import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PAYMENT_QUEUE } from './queue.constants';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(PAYMENT_QUEUE) private readonly paymentQueue: Queue,
  ) {}

  /**
   * Schedule payment verification polling.
   * Retries every 15 seconds for up to 15 minutes.
   * If user paid, it will be found within a few polls.
   */
  async schedulePaymentVerification(dealId: string): Promise<void> {
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
  }
}