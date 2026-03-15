import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue('payment') private readonly paymentQueue: Queue,
  ) {}

  async schedulePaymentVerification(dealId: string): Promise<void> {
    await this.paymentQueue.add(
      'verify-payment',
      { dealId },
      {
        delay: 15_000,
        attempts: 60,
        backoff: { type: 'fixed', delay: 15_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
