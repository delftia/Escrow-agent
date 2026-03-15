import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DealService } from '../deal/deal.service';
import { ArbitrationService } from '../arbitration/arbitration.service';
import { PaymentService } from '../payment/payment.service';

@Injectable()
export class DisputeService {
  private readonly logger = new Logger(DisputeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dealService: DealService,
    private readonly arbitrationService: ArbitrationService,
    private readonly paymentService: PaymentService,
  ) {}

  /**
   * Open a dispute for a deal.
   * Can be called by creator (during UNDER_REVIEW) or anyone if deadline passed.
   */
  async open(dealId: string, openedBy: bigint): Promise<void> {
    const deal = await this.dealService.findById(dealId);
    if (!deal) throw new NotFoundException('Deal not found');

    await this.prisma.dispute.upsert({
      where: { dealId },
      update: { openedBy },
      create: { dealId, openedBy },
    });

    await this.dealService.markDisputed(dealId);
    this.logger.log(`Dispute opened: deal ${dealId} by user ${openedBy}`);
  }

  /**
   * Submit evidence for a dispute.
   * Once BOTH sides submit evidence, arbitration is triggered automatically.
   * If only one side submits, arbitration is triggered after 24h by a cron job.
   */
  async submitEvidence(dealId: string, userId: bigint, text: string): Promise<'waiting' | 'arbitrating'> {
    const deal = await this.dealService.findById(dealId);
    if (!deal) throw new NotFoundException('Deal not found');

    const evidenceData = { text, submittedAt: new Date().toISOString() };

    const isCreator = deal.creatorId === userId;
    const isExecutor = deal.executorId === userId;

    if (isCreator) {
      await this.prisma.dispute.update({
        where: { dealId },
        data: { creatorEvidence: evidenceData },
      });
    } else if (isExecutor) {
      await this.prisma.dispute.update({
        where: { dealId },
        data: { executorEvidence: evidenceData },
      });
    }

    // Reload to check if both sides submitted
    const dispute = await this.prisma.dispute.findUnique({ where: { dealId } });

    if (dispute?.creatorEvidence && dispute?.executorEvidence) {
      // Both submitted → arbitrate immediately
      setImmediate(() => this.runArbitration(dealId));
      return 'arbitrating';
    }

    return 'waiting';
  }

  /**
   * Run AI arbitration, execute payment split, update deal status.
   * Can be called by cron if one side never submits evidence.
   */
  async runArbitration(dealId: string): Promise<void> {
    this.logger.log(`Starting arbitration for deal ${dealId}`);

    const deal = await this.dealService.findById(dealId);
    if (!deal) throw new NotFoundException('Deal not found');

    const dispute = await this.prisma.dispute.findUnique({ where: { dealId } });
    if (!dispute) throw new NotFoundException('Dispute not found');

    // Run AI arbitrator
    const verdict = await this.arbitrationService.arbitrate({
      contract: deal.contractJson as Record<string, any>,
      creatorEvidence: dispute.creatorEvidence as { text: string } | null,
      executorEvidence: dispute.executorEvidence as { text: string } | null,
    });

    // Save verdict to DB
    await this.prisma.dispute.update({
      where: { dealId },
      data: {
        verdictJson: verdict as any,
        executorSharePercent: verdict.executorSharePercent,
        resolvedAt: new Date(),
      },
    });

    // Execute payment split via @ton/mcp
    await this.paymentService.splitPayment(dealId, verdict.executorSharePercent);

    // Update deal status
    await this.dealService.resolvePartial(dealId, verdict.executorSharePercent);

    this.logger.log(
      `Arbitration complete for ${dealId}: executor gets ${verdict.executorSharePercent}%`,
    );
  }

  async findByDealId(dealId: string) {
    return this.prisma.dispute.findUnique({ where: { dealId } });
  }

  // Find disputes where evidence was submitted >24h ago but only one side responded
  async findStaleDisputes() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.prisma.dispute.findMany({
      where: {
        resolvedAt: null,
        createdAt: { lt: cutoff },
      },
    });
  }
}
