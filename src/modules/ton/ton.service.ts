import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { Address, beginCell, internal, toNano } from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { TonClient, WalletContractV5R1, SendMode } from '@ton/ton';

@Injectable()
export class TonService implements OnModuleInit {
  private readonly logger = new Logger(TonService.name);
  private readonly network = process.env.TON_NETWORK ?? 'testnet';

  private get toncenterApiBase() {
    return this.network === 'mainnet'
      ? 'https://toncenter.com/api/v2'
      : 'https://testnet.toncenter.com/api/v2';
  }

  private get toncenterRpcEndpoint() {
    return this.network === 'mainnet'
      ? 'https://toncenter.com/api/v2/jsonRPC'
      : 'https://testnet.toncenter.com/api/v2/jsonRPC';
  }

  async onModuleInit() {
    try {
      const address = await this.getEscrowAddress();
      this.logger.log(`Escrow wallet ready: ${address}`);
    } catch (err: any) {
      this.logger.error(
        'Escrow wallet init failed',
        err?.stack || err?.message || String(err),
      );
    }
  }

  private async getWalletContext() {
    const mnemonicRaw = process.env.MNEMONIC;
    if (!mnemonicRaw) throw new Error('MNEMONIC is not set');
  
    const mnemonic = mnemonicRaw.trim().split(/\s+/);
    const keyPair = await mnemonicToPrivateKey(mnemonic);
  
    const wallet = WalletContractV5R1.create({
      workchain: 0,
      publicKey: keyPair.publicKey,
      walletId: {
        networkGlobalId: this.network === 'mainnet' ? -239 : -3,
      },
    });
  
    const client = new TonClient({
      endpoint: this.toncenterRpcEndpoint,
      apiKey: process.env.TONCENTER_API_KEY,
    });
  
    return {
      client,
      keyPair,
      wallet,
      openedWallet: client.open(wallet),
      address: wallet.address,
    };
  }

  async getEscrowAddress(): Promise<string> {
    const { address } = await this.getWalletContext();
    return address.toString();
  }

  async getEscrowBalance(): Promise<number> {
    const { client, address } = await this.getWalletContext();
    const balanceNano = await client.getBalance(address);
    return Number(balanceNano) / 1e9;
  }

  async transfer(toAddress: string, amountTon: number, comment?: string): Promise<string> {
    const { openedWallet, keyPair, client, address } = await this.getWalletContext();
  
    const balanceNano = await client.getBalance(address);
    const amountNano = toNano(amountTon.toString());
    const reserveNano = toNano('0.02');
  
    this.logger.log(`Escrow address: ${address.toString()}`);
    this.logger.log(`Escrow balance before transfer: ${Number(balanceNano) / 1e9} TON`);
    this.logger.log(`Transferring ${amountTon} TON → ${toAddress}`);
  
    if (balanceNano < amountNano + reserveNano) {
      throw new Error(
        `Insufficient escrow balance for payout. Balance=${Number(balanceNano) / 1e9} TON, required≈${amountTon + 0.02} TON`,
      );
    }
  
    const seqnoBefore = await openedWallet.getSeqno();
  
    const body = comment
      ? beginCell().storeUint(0, 32).storeStringTail(comment).endCell()
      : undefined;
  
    let lastError: any;
  
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await openedWallet.sendTransfer({
          seqno: seqnoBefore,
          secretKey: keyPair.secretKey,
          sendMode: SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
          messages: [
            internal({
              to: Address.parse(toAddress),
              value: amountNano,
              bounce: false,
              body,
            }),
          ],
        });
  
        for (let i = 0; i < 5; i++) {
          await this.sleep(4000);
          const seqnoNow = await openedWallet.getSeqno();
          if (seqnoNow > seqnoBefore) {
            const txRef = `seqno:${seqnoNow}`;
            this.logger.log(`Transfer submitted successfully. Ref=${txRef}`);
            return txRef;
          }
        }
  
        throw new Error('Transfer submitted but seqno did not advance in time');
      } catch (err: any) {
        lastError = err;
  
        const status = err?.status || err?.response?.status;
        const message =
          err?.response?.data
            ? JSON.stringify(err.response.data)
            : err?.stack || err?.message || String(err);
  
        this.logger.error(`Transfer attempt ${attempt} failed`, message);
  
        if (status === 429 && attempt < 3) {
          await this.sleep(5000 * attempt);
          continue;
        }
  
        throw err;
      }
    }
  
    throw lastError;
  }

  async findIncomingTx(dealId: string, expectedAmountTon: number): Promise<string | null> {
    const walletAddress = await this.getEscrowAddress();

    try {
      const params: Record<string, string> = {
        address: walletAddress,
        limit: '30',
      };

      if (process.env.TONCENTER_API_KEY) {
        params.api_key = process.env.TONCENTER_API_KEY;
      }

      const res = await axios.get(`${this.toncenterApiBase}/getTransactions`, { params });
      const txs: any[] = res.data?.result ?? [];

      const expectedComment = `trustdeal:${dealId}`;

      for (const tx of txs) {
        const inMsg = tx.in_msg;
        if (!inMsg?.value) continue;

        const amountTon = Number(inMsg.value) / 1e9;
        const comment: string = inMsg.message ?? '';

        const amountMatch =
          Math.abs(amountTon - expectedAmountTon) / expectedAmountTon < 0.02;
        const commentMatch = comment.includes(expectedComment);

        if (amountMatch && commentMatch) {
          return tx.transaction_id?.hash ?? String(tx.utime);
        }
      }

      return null;
    } catch (err: any) {
      this.logger.error(
        'Toncenter query error',
        err?.response?.data
          ? JSON.stringify(err.response.data)
          : err?.stack || err?.message || String(err),
      );
      return null;
    }
  }

  async buildPaymentLink(dealId: string, amountTon: number): Promise<string> {
    const wallet = await this.getEscrowAddress();
    const nanotons = Math.floor(amountTon * 1e9);
    const comment = encodeURIComponent(`trustdeal:${dealId}`);
    return `ton://transfer/${wallet}?amount=${nanotons}&text=${comment}`;
  }

  async buildTonkeeperLink(dealId: string, amountTon: number): Promise<string> {
    const wallet = await this.getEscrowAddress();
    const nanotons = Math.floor(amountTon * 1e9);
    const comment = encodeURIComponent(`trustdeal:${dealId}`);
    return `https://app.tonkeeper.com/transfer/${wallet}?amount=${nanotons}&text=${comment}`;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}