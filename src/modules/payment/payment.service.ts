import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TonService } from '../ton/ton.service';
import { PaymentType, PaymentStatus } from '@prisma/client';

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ton: TonService,
  ) {}

  /**
   * STEP 1: Create a pending payment intent and return payment links.
   * Called when executor confirms the deal.
   */
  async createPaymentIntent(dealId: string): Promise<{ tonLink: string; tonkeeperLink: string }> {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) throw new Error('Deal not found');

    // Create pending record in DB
    await this.prisma.paymentIntent.create({
      data: {
        dealId,
        amountTon: deal.amountTon,
        type: PaymentType.LOCK,
        status: PaymentStatus.PENDING,
      },
    });

    return {
      tonLink: this.ton.buildPaymentLink(dealId, deal.amountTon),
      tonkeeperLink: this.ton.buildTonkeeperLink(dealId, deal.amountTon),
    };
  }

  /**
   * STEP 2: Poll blockchain to verify the payment arrived.
   * Called repeatedly by BullMQ queue until confirmed.
   * Returns true if confirmed.
   */
  async verifyPayment(dealId: string): Promise<boolean> {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) return false;

    const txHash = await this.ton.findIncomingTx(dealId, deal.amountTon);
    if (!txHash) return false;

    // Prevent double-confirmation
    const existing = await this.prisma.paymentIntent.findFirst({
      where: { dealId, type: PaymentType.LOCK, status: PaymentStatus.CONFIRMED },
    });
    if (existing) return true;

    await this.prisma.paymentIntent.updateMany({
      where: { dealId, type: PaymentType.LOCK, status: PaymentStatus.PENDING },
      data: { txHash, status: PaymentStatus.CONFIRMED, confirmedAt: new Date() },
    });

    this.logger.log(`Payment confirmed for deal ${dealId}. TX: ${txHash}`);
    return true;
  }

  /**
   * STEP 3A: Release full amount to executor (happy path).
   * Called when creator confirms the work is done.
   */
  async releaseToExecutor(dealId: string): Promise<string> {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal?.executorId) throw new Error('Deal or executor not found');

    const executor = await this.prisma.user.findUnique({ where: { id: deal.executorId } });
    if (!executor?.walletAddress) throw new Error('Executor has no wallet address');

    const txHash = await this.ton.transfer(
      executor.walletAddress,
      deal.amountTon,
      `TrustDeal payment: ${dealId.slice(0, 8)}`,
    );

    await this.prisma.paymentIntent.create({
      data: {
        dealId,
        amountTon: deal.amountTon,
        txHash,
        type: PaymentType.RELEASE,
        status: PaymentStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
    });

    this.logger.log(`Released ${deal.amountTon} TON to executor for deal ${dealId}`);
    return txHash;
  }

  /**
   * STEP 3B: Split payment based on arbitration verdict.
   * Called after AI arbitrator issues verdict.
   *
   * executorSharePercent = 0   → full refund to creator
   * executorSharePercent = 100 → full payment to executor
   * executorSharePercent = 70  → 70% to executor, 30% to creator
   */
  async splitPayment(dealId: string, executorSharePercent: number): Promise<void> {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal?.executorId) throw new Error('Deal or executor not found');

    const [executor, creator] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: deal.executorId } }),
      this.prisma.user.findUnique({ where: { id: deal.creatorId } }),
    ]);

    const total = deal.amountTon;
    // Keep 2 decimal precision, avoid dust
    const executorAmt = Math.round(total * executorSharePercent) / 100;
    const creatorAmt = Math.round((total - executorAmt) * 100) / 100;

    this.logger.log(
      `Splitting deal ${dealId}: ${executorAmt} TON → executor, ${creatorAmt} TON → creator`,
    );

    const tasks: Promise<void>[] = [];

    if (executorAmt > 0.01 && executor?.walletAddress) {
      tasks.push(
        this.ton
          .transfer(
            executor.walletAddress,
            executorAmt,
            `TrustDeal arbitration (${executorSharePercent}%): ${dealId.slice(0, 8)}`,
          )
          .then((txHash) =>
            this.prisma.paymentIntent
              .create({
                data: {
                  dealId,
                  amountTon: executorAmt,
                  txHash,
                  type: PaymentType.PARTIAL_RELEASE,
                  status: PaymentStatus.CONFIRMED,
                  confirmedAt: new Date(),
                },
              })
              .then(() => {}),
          ),
      );
    }

    if (creatorAmt > 0.01 && creator?.walletAddress) {
      tasks.push(
        this.ton
          .transfer(
            creator.walletAddress,
            creatorAmt,
            `TrustDeal refund (${100 - executorSharePercent}%): ${dealId.slice(0, 8)}`,
          )
          .then((txHash) =>
            this.prisma.paymentIntent
              .create({
                data: {
                  dealId,
                  amountTon: creatorAmt,
                  txHash,
                  type: PaymentType.REFUND,
                  status: PaymentStatus.CONFIRMED,
                  confirmedAt: new Date(),
                },
              })
              .then(() => {}),
          ),
      );
    }

    await Promise.all(tasks);
    this.logger.log(`Split complete for deal ${dealId}`);
  }

  async getPaymentHistory(dealId: string) {
    return this.prisma.paymentIntent.findMany({
      where: { dealId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
