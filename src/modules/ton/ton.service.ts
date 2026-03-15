import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';

/**
 * TonService wraps @ton/mcp running as HTTP server on port 3001.
 *
 * Start @ton/mcp before running the app:
 *   MNEMONIC="24 words" WALLET_VERSION=agentic AGENTIC_WALLET_ADDRESS=EQ... npx @ton/mcp@alpha --http 3001
 *
 * All private key operations happen inside @ton/mcp process.
 * This service only sends JSON-RPC calls to it.
 */
@Injectable()
export class TonService implements OnModuleInit {
  private readonly logger = new Logger(TonService.name);
  private readonly mcpUrl = 'http://localhost:3001/mcp';
  private readonly network = process.env.TON_NETWORK ?? 'testnet';

  private get toncenterBase() {
    return this.network === 'mainnet'
      ? 'https://toncenter.com/api/v2'
      : 'https://testnet.toncenter.com/api/v2';
  }

  async onModuleInit() {
    // Verify @ton/mcp is reachable
    try {
      await this.getEscrowBalance();
      this.logger.log('@ton/mcp connected successfully');
    } catch {
      this.logger.warn(
        '@ton/mcp not reachable. Make sure it is running on port 3001.\n' +
          'Run: MNEMONIC="..." WALLET_VERSION=agentic npx @ton/mcp@alpha --http 3001',
      );
    }
  }

  /**
   * Send TON from escrow wallet to any address
   */
  async transfer(toAddress: string, amountTon: number, comment?: string): Promise<string> {
    this.logger.log(`Transferring ${amountTon} TON → ${toAddress}`);

    const res = await axios.post(this.mcpUrl, {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: 'send_ton',
        arguments: {
          to: toAddress,
          amount: String(amountTon),
          comment: comment ?? '',
        },
      },
    });

    const result = res.data?.result;
    if (result?.isError) {
      throw new Error(`@ton/mcp transfer failed: ${JSON.stringify(result.content)}`);
    }

    const txHash: string = result?.content?.[0]?.text ?? 'unknown_hash';
    this.logger.log(`Transfer done. TX: ${txHash}`);
    return txHash;
  }

  /**
   * Get current balance of the escrow agentic wallet
   */
  async getEscrowBalance(): Promise<number> {
    const res = await axios.post(this.mcpUrl, {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: 'get_balance', arguments: {} },
    });

    const text: string = res.data?.result?.content?.[0]?.text ?? '0';
    // text looks like "Balance: 12.5 TON" or just "12.5"
    const match = text.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : 0;
  }

  /**
   * Poll TON blockchain for incoming transaction matching dealId comment and amount.
   * Returns tx hash if found, null otherwise.
   *
   * How it works:
   * 1. We query the last 20 transactions of our escrow wallet via Toncenter API
   * 2. For each incoming tx we check:
   *    - comment contains "trustdeal:<dealId>"
   *    - amount is within 1% of expected (to handle rounding)
   * 3. If match found → return tx hash
   */
  async findIncomingTx(dealId: string, expectedAmountTon: number): Promise<string | null> {
    const walletAddress = process.env.AGENTIC_WALLET_ADDRESS;
    if (!walletAddress) {
      this.logger.error('AGENTIC_WALLET_ADDRESS not set');
      return null;
    }

    try {
      const params: Record<string, string> = {
        address: walletAddress,
        limit: '30',
      };
      if (process.env.TONCENTER_API_KEY) {
        params.api_key = process.env.TONCENTER_API_KEY;
      }

      const res = await axios.get(`${this.toncenterBase}/getTransactions`, { params });
      const txs: any[] = res.data?.result ?? [];

      const expectedComment = `trustdeal:${dealId}`;

      for (const tx of txs) {
        const inMsg = tx.in_msg;
        if (!inMsg?.value) continue;

        const amountTon = Number(inMsg.value) / 1e9;
        const comment: string = inMsg.message ?? '';

        const amountMatch = Math.abs(amountTon - expectedAmountTon) / expectedAmountTon < 0.02;
        const commentMatch = comment.includes(expectedComment);

        if (amountMatch && commentMatch) {
          return tx.transaction_id?.hash ?? String(tx.utime);
        }
      }

      return null;
    } catch (err) {
      this.logger.error('Toncenter query error', err);
      return null;
    }
  }

  /**
   * Build a TON deeplink that opens Tonkeeper with pre-filled transfer.
   * User just taps "Confirm" in their wallet.
   *
   * Format: ton://transfer/<address>?amount=<nanotons>&text=<comment>
   */
  buildPaymentLink(dealId: string, amountTon: number): string {
    const wallet = process.env.AGENTIC_WALLET_ADDRESS;
    const nanotons = Math.floor(amountTon * 1e9);
    const comment = encodeURIComponent(`trustdeal:${dealId}`);
    return `ton://transfer/${wallet}?amount=${nanotons}&text=${comment}`;
  }

  /**
   * Same link but for Tonkeeper web
   */
  buildTonkeeperLink(dealId: string, amountTon: number): string {
    const wallet = process.env.AGENTIC_WALLET_ADDRESS;
    const nanotons = Math.floor(amountTon * 1e9);
    const comment = encodeURIComponent(`trustdeal:${dealId}`);
    return `https://app.tonkeeper.com/transfer/${wallet}?amount=${nanotons}&text=${comment}`;
  }
}
