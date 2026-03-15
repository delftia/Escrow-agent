import { Injectable } from '@nestjs/common';

@Injectable()
export class ContractService {
  formatPreview(
    contract: Record<string, any>,
    amountTon: number,
    deadlineHours: number,
  ): string {
    const deliverables = (contract.deliverables as string[])
      ?.map((d) => `  • ${d}`)
      .join('\n') ?? '  • —';

    const criteria = (contract.acceptanceCriteria as string[])
      ?.map((c) => `  • ${c}`)
      .join('\n') ?? '  • —';

    const deadline =
      deadlineHours >= 24
        ? `${Math.round(deadlineHours / 24)} day(s)`
        : `${deadlineHours} hour(s)`;

    return (
      `📋 *Contract Preview*\n\n` +
      `*Service:* ${contract.serviceType}\n` +
      `*Amount:* ${amountTon} TON\n` +
      `*Deadline:* ${deadline}\n\n` +
      `*Deliverables:*\n${deliverables}\n\n` +
      `*Acceptance criteria:*\n${criteria}`
    );
  }

  validate(contract: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!contract?.serviceType) errors.push('Missing service type');
    if (!contract?.deliverables?.length) errors.push('Missing deliverables');
    if (!contract?.acceptanceCriteria?.length) errors.push('Missing acceptance criteria');
    return { valid: errors.length === 0, errors };
  }
}
