import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: { id: bigint; username?: string; firstName?: string }) {
    return this.prisma.user.upsert({
      where: { id: data.id },
      update: { username: data.username, firstName: data.firstName },
      create: { id: data.id, username: data.username, firstName: data.firstName },
    });
  }

  async findById(id: bigint) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async updateWallet(userId: bigint, walletAddress: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { walletAddress },
    });
  }

  async incrementDeals(userId: bigint) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { dealsCount: { increment: 1 } },
    });
  }
}
