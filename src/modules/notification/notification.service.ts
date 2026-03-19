import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InlineKeyboard } from 'grammy';
import { PrismaService } from '../../database/prisma.service';
import { BotService } from '../bot/bot.service';
import dayjs from 'dayjs';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly botService: BotService,
  ) {}

  async send(userId: bigint, text: string, keyboard?: InlineKeyboard): Promise<void> {
    try {
      await this.botService.bot.api.sendMessage(Number(userId), text, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } catch (err) {
      this.logger.warn(`Cannot notify user ${userId}: ${err?.message}`);
    }
  }

  async onExecutorConfirmed(dealId: string): Promise<void> {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) return;
    await this.send(
      deal.creatorId,
      `🎯 *Executor accepted your deal!*\n\nDeal \`${dealId.slice(0, 8)}\` is ready.\nLock *${deal.amountTon} TON* in escrow to start the work.`,
      new InlineKeyboard().text(`💎 Lock funds`, `pay:${dealId}`)
    );
  }

  async onPaymentConfirmed(dealId: string): Promise<void> {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal?.executorId) return;
    const deadline = deal.deadlineAt ? dayjs(deal.deadlineAt).format('DD MMM YYYY, HH:mm') : 'Not set';
    await this.send(
      deal.executorId,
      `💎 *Funds locked in escrow!*\n\nDeal \`${dealId.slice(0, 8)}\` is now active.\n*${deal.amountTon} TON* secured.\nDeadline: *${deadline}*`,
      new InlineKeyboard().text('📤 Submit Result', `submit:${dealId}`),
    );
    await this.send(
      deal.creatorId,
      `✅ *Payment confirmed!*\n\nYour *${deal.amountTon} TON* is locked in escrow.\nDeadline: *${deadline}*`,
    );
  }

  async onResultSubmitted(dealId: string): Promise<void> {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) return;
    await this.send(
      deal.creatorId,
      `📦 *Work submitted!*\n\nThe executor submitted their result for deal \`${dealId.slice(0, 8)}\`.\nPlease review and confirm or open a dispute.\n_You have 24 hours before auto-release._`,
      new InlineKeyboard()
        .text('✅ Confirm & Release', `complete:${dealId}`).row()
        .text('⚖️ Open Dispute', `dispute:${dealId}`),
    );
  }

  async onDealCompleted(dealId: string, txHash: string): Promise<void> {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal?.executorId) return;
    await this.send(
      deal.executorId,
      `🎉 *Payment released!*\n\n*${deal.amountTon} TON* sent to your wallet.\nTX: \`${txHash.slice(0, 20)}...\``,
    );
    await this.send(deal.creatorId, `✅ *Deal completed!*\n\nThank you for using TrustDeal.`);
  }

  async onVerdictIssued(dealId: string, verdictText: string): Promise<void> {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal?.executorId) return;
    await this.send(deal.creatorId, verdictText);
    await this.send(deal.executorId, verdictText);
  }

  // ─── Cron every hour: deadline reminders ────────────────────────────────────

  @Cron(CronExpression.EVERY_HOUR)
  async checkDeadlines(): Promise<void> {
    const now = new Date();
    const in24h = dayjs().add(24, 'hour').toDate();

    // Approaching deadline — remind executor
    const approaching = await this.prisma.deal.findMany({
      where: { status: 'ACTIVE', deadlineAt: { lte: in24h, gte: now } },
    });
    for (const deal of approaching) {
      if (!deal.executorId) continue;
      const hoursLeft = dayjs(deal.deadlineAt).diff(dayjs(), 'hour');
      await this.send(
        deal.executorId,
        `⏰ *Deadline in ${hoursLeft} hours!*\n\nDeal \`${deal.id.slice(0, 8)}\` expires soon. Submit your result!`,
        new InlineKeyboard().text('📤 Submit Result', `submit:${deal.id}`),
      );
    }

    // Overdue — notify creator
    const overdue = await this.prisma.deal.findMany({
      where: { status: 'ACTIVE', deadlineAt: { lt: now } },
    });
    for (const deal of overdue) {
      await this.send(
        deal.creatorId,
        `⚠️ *Deal overdue!*\n\nDeal \`${deal.id.slice(0, 8)}\` passed its deadline.\nOpen a dispute to get a refund.`,
        new InlineKeyboard().text('⚖️ Open Dispute', `dispute:${deal.id}`),
      );
    }
  }
}