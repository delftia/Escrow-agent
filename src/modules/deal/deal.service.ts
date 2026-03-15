import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DealStatus } from '@prisma/client';
import dayjs from 'dayjs';

export interface CreateDealDto {
  creatorId: bigint;
  rawDescription: string;
  contractJson: Record<string, any>;
  amountTon: number;
  deadlineHours: number;
}

@Injectable()
export class DealService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDealDto) {
    return this.prisma.deal.create({
      data: {
        creatorId: dto.creatorId,
        rawDescription: dto.rawDescription,
        contractJson: dto.contractJson,
        amountTon: dto.amountTon,
        deadlineAt: dayjs().add(dto.deadlineHours, 'hour').toDate(),
        status: DealStatus.NEGOTIATING,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.deal.findUnique({ where: { id } });
  }

  async findByInviteToken(token: string) {
    return this.prisma.deal.findUnique({ where: { inviteToken: token } });
  }

  async findByUser(userId: bigint) {
    return this.prisma.deal.findMany({
      where: { OR: [{ creatorId: userId }, { executorId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async confirmExecutor(dealId: string, executorId: bigint) {
    const deal = await this.findById(dealId);
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.creatorId === executorId) throw new ForbiddenException('Cannot be executor of own deal');
    if (deal.status !== DealStatus.NEGOTIATING) throw new ForbiddenException('Deal not in negotiating state');

    return this.prisma.deal.update({
      where: { id: dealId },
      data: { executorId, status: DealStatus.AWAITING_PAYMENT },
    });
  }

  async markPaid(dealId: string) {
    return this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.ACTIVE },
    });
  }

  async submitResult(dealId: string, executorId: bigint) {
    const deal = await this.findById(dealId);
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.executorId !== executorId) throw new ForbiddenException('Not your deal');
    if (deal.status !== DealStatus.ACTIVE) throw new ForbiddenException('Deal is not active');

    return this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.UNDER_REVIEW },
    });
  }

  async complete(dealId: string, creatorId: bigint) {
    const deal = await this.findById(dealId);
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.creatorId !== creatorId) throw new ForbiddenException('Not your deal');
    if (deal.status !== DealStatus.UNDER_REVIEW) throw new ForbiddenException('Deal is not under review');

    return this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.COMPLETED, completedAt: new Date() },
    });
  }

  async markDisputed(dealId: string) {
    return this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.DISPUTED },
    });
  }

  async resolvePartial(dealId: string, executorSharePercent: number) {
    let status: DealStatus;
    if (executorSharePercent === 100) status = DealStatus.COMPLETED;
    else if (executorSharePercent === 0) status = DealStatus.REFUNDED;
    else status = DealStatus.PARTIALLY_RESOLVED;

    return this.prisma.deal.update({
      where: { id: dealId },
      data: { status, completedAt: new Date() },
    });
  }

  async cancel(dealId: string, userId: bigint) {
    const deal = await this.findById(dealId);
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.creatorId !== userId) throw new ForbiddenException('Not your deal');
    if (!['DRAFT', 'NEGOTIATING'].includes(deal.status)) {
      throw new ForbiddenException('Cannot cancel deal with locked funds');
    }

    return this.prisma.deal.update({
      where: { id: dealId },
      data: { status: DealStatus.CANCELED },
    });
  }

  async addMessage(
    dealId: string,
    role: 'CREATOR' | 'EXECUTOR' | 'ARBITRATOR' | 'SYSTEM',
    content: string,
  ) {
    return this.prisma.dealMessage.create({
      data: { dealId, role, content },
    });
  }

  async getMessages(dealId: string) {
    return this.prisma.dealMessage.findMany({
      where: { dealId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Find active deals with approaching deadlines
  async findApproachingDeadline(withinHours: number) {
    const now = new Date();
    const threshold = dayjs().add(withinHours, 'hour').toDate();
    return this.prisma.deal.findMany({
      where: { status: DealStatus.ACTIVE, deadlineAt: { lte: threshold, gte: now } },
    });
  }

  // Find overdue active deals
  async findOverdue() {
    return this.prisma.deal.findMany({
      where: { status: DealStatus.ACTIVE, deadlineAt: { lt: new Date() } },
    });
  }
}
