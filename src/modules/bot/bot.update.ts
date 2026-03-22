import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InlineKeyboard } from 'grammy';
import { BotService } from './bot.service';
import { BotContext } from './bot.types';
import { UserService } from '../user/user.service';
import { DealService } from '../deal/deal.service';
import { IntentService } from '../intent/intent.service';
import { ContractService } from '../contract/contract.service';
import { PaymentService } from '../payment/payment.service';
import { DisputeService } from '../dispute/dispute.service';
import { ArbitrationService } from '../arbitration/arbitration.service';
import { NotificationService } from '../notification/notification.service';
import { QueueService } from '../queue/queue.service';
import { isDemoMode } from '../../common/app-mode';

@Injectable()
export class BotUpdate implements OnModuleInit {
  private readonly logger = new Logger(BotUpdate.name);

  constructor(
    private readonly bot: BotService,
    private readonly users: UserService,
    private readonly deals: DealService,
    private readonly intent: IntentService,
    private readonly contract: ContractService,
    private readonly payment: PaymentService,
    private readonly dispute: DisputeService,
    private readonly arbitration: ArbitrationService,
    private readonly notifications: NotificationService,
    private readonly queue: QueueService,
  ) { }

  onModuleInit() {
    const { bot } = this.bot;

    bot.command('start', async (ctx) => {
      await this.resetFlow(ctx);
      const userId = BigInt(ctx.from!.id);
      await this.users.upsert({
        id: userId,
        username: ctx.from!.username,
        firstName: ctx.from!.first_name,
      });

      const payload = ctx.match as string;
      if (payload?.startsWith('invite_')) {
        const token = payload.replace('invite_', '');
        await this.handleInvite(ctx, token);
        return;
      }

      await ctx.reply(
        `👋 Welcome to *TrustDeal*\n\n` +
        `Safe deals between two people using TON escrow and AI arbitration.\n\n` +
        `*How it works:*\n` +
        `1️⃣ Describe your deal in plain text\n` +
        `2️⃣ AI structures the contract\n` +
        `3️⃣ TON locks the funds in escrow\n` +
        `4️⃣ AI arbitrates any disputes automatically`,
        { parse_mode: 'Markdown', reply_markup: this.bot.mainMenu() },
      );
    });

    bot.command('newdeal', async (ctx) => {
      await this.resetFlow(ctx);
      ctx.session.step = 'awaiting_description';
      ctx.session.draftDeal = {};

      await ctx.reply(
        `📝 <b>Create a new deal</b>\n\nDescribe your deal in plain text.`,
        { parse_mode: 'HTML' },
      );
    });

    bot.command('deals', async (ctx) => {
      await this.resetFlow(ctx);
      await this.showMyDeals(ctx);
    });

    bot.command('wallet', async (ctx) => {
      await this.resetFlow(ctx);
      await this.showWallet(ctx);
    });

    bot.command('help', async (ctx) => {
      await this.resetFlow(ctx);
      await ctx.reply(
        `❓ <b>How TrustDeal works</b>\n\nUse the buttons or commands to create and manage deals.`,
        {
          parse_mode: 'HTML',
          reply_markup: this.bot.mainMenu(),
        },
      );
    });

    bot.command('cancel', async (ctx) => {
      await this.resetFlow(ctx);
      await ctx.reply('Current action cancelled.', {
        reply_markup: this.bot.mainMenu(),
      });
    });

    // ─── Menu callbacks ──────────────────────────────────────────────────────

    bot.callbackQuery('menu:new_deal', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      ctx.session.step = 'awaiting_description';
      ctx.session.draftDeal = {};
      await ctx.reply(
        `📝 *Create a new deal*\n\n` +
        `Describe your deal in plain text. For example:\n\n` +
        `_"I want to order a logo design for 50 TON, deadline 3 days. ` +
        `I need 3 concepts in PNG and SVG format."_\n\n` +
        `Just write naturally — I'll handle the rest.`,
        { parse_mode: 'Markdown' },
      );
    });

    bot.callbackQuery('menu:my_deals', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.resetFlow(ctx);
      await this.showMyDeals(ctx);
    });

    bot.callbackQuery('menu:wallet', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.showWallet(ctx);
    });

    bot.callbackQuery('menu:help', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await ctx.reply(
        `❓ *How TrustDeal works*\n\n` +
        `*Creating a deal:*\n` +
        `Write what you need in plain text. The AI agent will ask clarifying questions ` +
        `and build a structured contract with deliverables and acceptance criteria.\n\n` +
        `*Escrow:*\n` +
        `After both parties agree, the client pays TON into escrow. ` +
        `Funds are locked in an agentic wallet until the deal is resolved.\n\n` +
        `*Completing a deal:*\n` +
        `The executor submits their result. The client confirms — funds are released instantly.\n\n` +
        `*Disputes:*\n` +
        `If there's a disagreement, an AI arbitrator analyzes both sides' evidence ` +
        `against the original contract and issues a fair verdict. ` +
        `Funds are split automatically.\n\n` +
        `*Fee:* 1% of deal amount\n\n` +
        `_Note: funds are held in a centralized escrow wallet. ` +
        `Smart contract escrow coming in V2._`,
        { parse_mode: 'Markdown', reply_markup: this.bot.mainMenu() },
      );
    });

    bot.callbackQuery('menu:home', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.resetFlow(ctx);
      await ctx.reply('Use the menu to get started:', {
        reply_markup: this.bot.mainMenu(),
      });
    });

    // ─── Deal view ───────────────────────────────────────────────────────────

    bot.callbackQuery(/^view:(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const dealId = ctx.match[1];
      await this.showDeal(ctx, dealId);
    });

    // ─── Contract confirm ────────────────────────────────────────────────────

    bot.callbackQuery('contract:confirm', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const userId = BigInt(ctx.from!.id);
      const draft = ctx.session.draftDeal;

      if (!draft.contractJson || !draft.amountTon) {
        await ctx.reply('Something went wrong. Please start over.', {
          reply_markup: this.bot.mainMenu(),
        });
        return;
      }

      const deal = await this.deals.create({
        creatorId: userId,
        rawDescription: draft.rawDescription!,
        contractJson: draft.contractJson,
        amountTon: draft.amountTon,
        deadlineHours: draft.deadlineHours ?? 72,
      });

      ctx.session.step = 'idle';
      ctx.session.draftDeal = {};

      const botUsername = ctx.me.username;
      const inviteLink = this.buildInviteLink(botUsername, deal.inviteToken);

      await ctx.reply(
        `✅ <b>Deal created!</b>\n\n` +
        `Share this link with the person who will do the work:\n\n` +
        `<a href="${this.escapeHtml(inviteLink)}">${this.escapeHtml(inviteLink)}</a>\n\n` +
        `Once they accept, you'll be asked to lock the funds.`,
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text('📋 My Deals', 'menu:my_deals').row()
            .text('🏠 Main menu', 'menu:home'),
        },
      );
    });

    bot.callbackQuery('contract:edit', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      ctx.session.step = 'awaiting_description';
      ctx.session.draftDeal = {};
      await ctx.reply('OK, let\'s start over. Describe the deal again:');
    });

    bot.callbackQuery('contract:cancel', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      ctx.session.step = 'idle';
      ctx.session.draftDeal = {};
      await ctx.reply('Cancelled.', { reply_markup: this.bot.mainMenu() });
    });

    // ─── Executor confirms deal via invite ───────────────────────────────────

    bot.callbackQuery(/^accept:(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const dealId = ctx.match[1];
      const userId = BigInt(ctx.from!.id);

      try {
        await this.deals.confirmExecutor(dealId, userId);

        // Register executor if not in DB
        await this.users.upsert({
          id: userId,
          username: ctx.from!.username,
          firstName: ctx.from!.first_name,
        });

        await ctx.reply(
          `✅ *You accepted the deal!*\n\n` +
          `The client has been notified and will now lock the funds.\n` +
          `You'll receive a notification when the money is in escrow.`,
          { parse_mode: 'Markdown' },
        );

        // Notify creator
        await this.notifications.onExecutorConfirmed(dealId);
      } catch (err) {
        await ctx.reply(`❌ ${err.message}`);
      }
    });

    bot.callbackQuery(/^decline:(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await ctx.reply('You declined the deal.');
    });

    // ─── Payment ─────────────────────────────────────────────────────────────

    bot.callbackQuery(/^pay:(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const dealId = ctx.match[1];
      const userId = BigInt(ctx.from!.id);
      await this.handlePayment(ctx, dealId, userId);
    });

    // User clicks "I paid" after sending TON
    bot.callbackQuery(/^paid:(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const dealId = ctx.match[1];
    
      if (isDemoMode()) {
        await ctx.reply(
          `⏳ *Simulating blockchain confirmation...*\n\n` +
            `This takes a couple of seconds in demo mode.`,
          { parse_mode: 'Markdown' },
        );
      
        setTimeout(async () => {
          try {
            await this.payment.confirmDemoPayment(dealId);
            await this.deals.markPaid(dealId);
            await this.notifications.onFundsLocked(dealId);
      
            await ctx.reply(
              `✅ *Payment confirmed!*\n\n` +
                `Your funds are locked in escrow.\n` +
                `This was simulated in demo mode.`,
              { parse_mode: 'Markdown' },
            );
          } catch (err: any) {
            await ctx.reply(`❌ ${err?.message ?? err}`);
          }
        }, 2000);
      
        return;
      }
    
      await ctx.reply(
        `⏳ *Checking payment...*\n\n` +
          `I'm monitoring the blockchain. You'll be notified once the transaction is confirmed.\n` +
          `This usually takes 10–30 seconds.`,
        { parse_mode: 'Markdown' },
      );
    
      void this.queue.schedulePaymentVerification(dealId).catch(async (err) => {
        this.logger.error(`Failed to schedule payment verification for ${dealId}`, err);
    
        try {
          await ctx.reply(
            `❌ I couldn't start blockchain monitoring right now.\n\nPlease try again in a few seconds.`,
            { reply_markup: this.bot.mainMenu() },
          );
        } catch {}
      });
    });

    // ─── Submit result ───────────────────────────────────────────────────────

    bot.callbackQuery(/^submit:(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const dealId = ctx.match[1];
      const userId = BigInt(ctx.from!.id);

      try {
        await this.deals.submitResult(dealId, userId);
        await this.notifications.onResultSubmitted(dealId);
        await ctx.reply(
          `📤 *Result submitted!*\n\n` +
          `The client has been notified. They have 24 hours to confirm or open a dispute.`,
          { parse_mode: 'Markdown' },
        );
      } catch (err) {
        await ctx.reply(`❌ ${err.message}`);
      }
    });

    // ─── Complete deal (creator confirms) ───────────────────────────────────

    bot.callbackQuery(/^complete:(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const dealId = ctx.match[1];
      const userId = BigInt(ctx.from!.id);

      try {
        await this.deals.assertCanComplete(dealId, userId);

        const loadingMsg = await ctx.reply(
          isDemoMode() ? '💸 Simulating payout...' : '💸 Releasing payment...',
        );
        
        const txHash = isDemoMode()
          ? await this.payment.releaseToExecutorDemo(dealId)
          : await this.payment.releaseToExecutor(dealId);
        
        await this.deals.markCompleted(dealId);
        await this.notifications.onDealCompleted(dealId, txHash);

        await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => { });
        await ctx.reply(
          isDemoMode()
            ? `🎉 *Deal completed!*\n\n` +
              `Payment released to the executor.\n` +
              `Demo ref: \`${txHash}\``
            : `🎉 *Deal completed!*\n\n` +
              `Payment released to the executor.\n` +
              `TX: \`${txHash.slice(0, 20)}...\``,
          { parse_mode: 'Markdown', reply_markup: this.bot.mainMenu() },
        );
      } catch (err) {
        const message = String(err?.message || err);

        if (message.includes('429')) {
          await ctx.reply(
            `❌ Network is temporarily busy while sending the payout.\n\nPlease try again in 10–20 seconds.`,
            { reply_markup: this.bot.mainMenu() },
          );
          return;
        }
        
        await ctx.reply(`❌ ${message}`);
      }
    });

    // ─── Dispute ─────────────────────────────────────────────────────────────

    bot.callbackQuery(/^dispute:(.+)$/, async (ctx) => {
      await this.safeAnswerCallback(ctx);
      const dealId = ctx.match[1];
      const userId = BigInt(ctx.from!.id);

      await this.dispute.open(dealId, userId);

      ctx.session.step = 'awaiting_dispute_evidence';
      ctx.session.activeDealId = dealId;

      await ctx.reply(
        `⚖️ *Dispute opened*\n\n` +
        `Please describe:\n` +
        `• What exactly was NOT delivered\n` +
        `• How it differs from the agreed contract\n\n` +
        `Be as specific as possible. The AI arbitrator will use this as evidence.`,
        { parse_mode: 'Markdown' },
      );
    });

    // ─── Wallet ──────────────────────────────────────────────────────────────

    bot.callbackQuery('wallet:set', async (ctx) => {
      await this.safeAnswerCallback(ctx);
      await this.resetFlow(ctx);

      ctx.session.step = 'awaiting_wallet';

      await ctx.reply(
        `Please send your TON wallet address (starts with EQ or UQ):`,
        {
          reply_markup: new InlineKeyboard()
            .text('❌ Cancel', 'menu:home'),
        },
      );
    });

    // ─── Text messages ───────────────────────────────────────────────────────

    bot.on('message:text', async (ctx) => {
      const text = ctx.message.text;
      const { step } = ctx.session;

      if (step === 'awaiting_wallet') {
        const wallet = text.trim();

        if ((wallet.startsWith('EQ') || wallet.startsWith('UQ')) && wallet.length > 40) {
          await this.users.updateWallet(BigInt(ctx.from!.id), wallet);

          const pendingWalletDealId = ctx.session.pendingWalletDealId;
          ctx.session.step = 'idle';
          ctx.session.pendingWalletDealId = undefined;

          await ctx.reply(
            `✅ <b>Wallet saved:</b>\n<code>${this.escapeHtml(wallet)}</code>`,
            {
              parse_mode: 'HTML',
              reply_markup: new InlineKeyboard()
                .text('🏠 Main menu', 'menu:home')
                .row()
                .text('👛 My wallet', 'menu:wallet'),
            },
          );

          if (pendingWalletDealId) {
            await this.handlePayment(ctx, pendingWalletDealId, BigInt(ctx.from!.id));
          }

          return;
        }

        await ctx.reply(
          `❌ Invalid wallet address.\n\nPlease send a valid TON wallet address starting with EQ or UQ.`,
          {
            reply_markup: new InlineKeyboard()
              .text('❌ Cancel', 'menu:home'),
          },
        );
        return;
      }

      if (step === 'awaiting_description') {
        await this.handleDescription(ctx, text);
        return;
      }

      if (step === 'awaiting_clarification') {
        await this.handleClarification(ctx, text);
        return;
      }

      if (step === 'awaiting_dispute_evidence') {
        await this.handleDisputeEvidence(ctx, text);
        return;
      }

      // Default
      await ctx.reply(
        `Use the menu to get started:`,
        { reply_markup: this.bot.mainMenu() },
      );
    });
  }

  // ─── Private handlers ─────────────────────────────────────────────────────

  private async handleDescription(ctx: BotContext, text: string) {
    const loading = await ctx.reply('🤔 Analyzing your request...');

    const result = await this.intent.parse(text);

    ctx.session.draftDeal = {
      rawDescription: text,
      enrichedText: text,
      contractJson: result.contract,
      amountTon: result.amountTon,
      deadlineHours: result.deadlineHours,
    };

    await ctx.api.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => { });

    if (result.missingInfo.length > 0) {
      ctx.session.step = 'awaiting_clarification';
      ctx.session.draftDeal.pendingQuestion = result.missingInfo[0];
      await ctx.reply(
        `I need one more detail:\n\n*${result.missingInfo[0]}*`,
        { parse_mode: 'Markdown' },
      );
    } else {
      await this.showContractPreview(ctx);
    }
  }

  private async handleClarification(ctx: BotContext, answer: string) {
    const draft = ctx.session.draftDeal;
    // Append Q+A to enriched text
    const enriched = `${draft.enrichedText}\n${draft.pendingQuestion}: ${answer}`;
    ctx.session.draftDeal.enrichedText = enriched;

    const loading = await ctx.reply('✏️ Updating contract...');
    const result = await this.intent.parse(enriched);
    await ctx.api.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => { });

    ctx.session.draftDeal.contractJson = result.contract;
    ctx.session.draftDeal.amountTon = result.amountTon;
    ctx.session.draftDeal.deadlineHours = result.deadlineHours;

    if (result.missingInfo.length > 0) {
      ctx.session.draftDeal.pendingQuestion = result.missingInfo[0];
      await ctx.reply(
        `One more thing:\n\n*${result.missingInfo[0]}*`,
        { parse_mode: 'Markdown' },
      );
    } else {
      ctx.session.step = 'idle';
      await this.showContractPreview(ctx);
    }
  }

  private async showContractPreview(ctx: BotContext) {
    const draft = ctx.session.draftDeal;
    const preview = this.contract.formatPreview(
      draft.contractJson!,
      draft.amountTon!,
      draft.deadlineHours ?? 72,
    );

    const keyboard = new InlineKeyboard()
      .text('✅ Confirm & Create', 'contract:confirm').row()
      .text('✏️ Start over', 'contract:edit').row()
      .text('❌ Cancel', 'contract:cancel');

    await ctx.reply(`${preview}\n\n_Confirm to create the deal and get a share link._`, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  private async handleInvite(ctx: BotContext, token: string) {
    const deal = await this.deals.findByInviteToken(token);

    if (!deal) {
      await ctx.reply('❌ This invite link is invalid or has expired.');
      return;
    }

    if (deal.status !== 'NEGOTIATING') {
      await ctx.reply('⚠️ This deal already has an executor or is no longer available.');
      return;
    }

    const c = deal.contractJson as Record<string, any>;
    const deliverables = (c?.deliverables as string[])?.map((d) => `  • ${d}`).join('\n') ?? '  • —';

    await ctx.reply(
      `🤝 *You've been invited to a deal*\n\n` +
      `*Service:* ${c?.serviceType}\n` +
      `*Amount you'll receive:* ${deal.amountTon} TON\n\n` +
      `*Your deliverables:*\n${deliverables}\n\n` +
      `Do you accept these terms?`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .text('✅ Accept', `accept:${deal.id}`).row()
          .text('❌ Decline', `decline:${deal.id}`),
      },
    );
  }

  private async handlePayment(ctx: BotContext, dealId: string, userId: bigint) {
    const user = await this.users.findById(userId);

    if (!user?.walletAddress) {
      ctx.session.step = 'awaiting_wallet';
      ctx.session.pendingWalletDealId = dealId;

      await ctx.reply(
        `👛 <b>Wallet required</b>\n\n` +
        `To pay, I need your TON wallet address to send refunds if needed.\n\n` +
        `Please send your wallet address (starts with EQ or UQ):`,
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text('❌ Cancel', 'menu:home'),
        },
      );
      return;
    }

    const deal = await this.deals.findById(dealId);
    if (!deal) return;

    const links = await this.payment.createPaymentIntent(dealId);

    if (isDemoMode()) {
      await ctx.reply(
        `💎 *Demo payment required*\n\n` +
          `Deal amount: *${deal.amountTon} TON*\n` +
          `Escrow lock amount: *${links.lockAmountTon} TON*\n\n` +
          `The extra amount covers network fees so funds can be safely released or refunded.\n\n` +
          `TON escrow is configured and available in production mode.\n` +
          `For hackathon demo, blockchain settlement is simulated so you can test the full flow instantly.`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard()
            .url('Open in Tonkeeper', links.tonkeeperLink).row()
            .url('Open in TON Wallet', links.tonLink).row()
            .text('✅ Simulate payment', `paid:${dealId}`),
        },
      );
      return;
    }
    
    await ctx.reply(
      `💎 *Payment required*\n\n` +
        `Deal amount: *${deal.amountTon} TON*\n` +
        `Escrow lock amount: *${links.lockAmountTon} TON*\n\n` +
        `The extra amount covers network fees so funds can be safely released or refunded.\n\n` +
        `Use one of the links below to open your wallet with pre-filled details.\n` +
        `After sending, tap *"I paid"* and I'll confirm on the blockchain.`,
      {
        parse_mode: 'Markdown',
        reply_markup: new InlineKeyboard()
          .url('Open in Tonkeeper', links.tonkeeperLink).row()
          .url('Open in TON Wallet', links.tonLink).row()
          .text('✅ I paid', `paid:${dealId}`),
      },
    );
  }

  private async safeAnswerCallback(ctx: BotContext) {
    if (!ctx.callbackQuery) return;

    try {
      await ctx.answerCallbackQuery();
    } catch (err: any) {
      this.logger.warn(`Failed to answer callback query: ${err?.message ?? err}`);
    }
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private buildInviteLink(botUsername: string, inviteToken: string) {
    return `https://t.me/${botUsername}?start=invite_${inviteToken}`;
  }

  private async handleDisputeEvidence(ctx: BotContext, text: string) {
    const dealId = ctx.session.activeDealId;
    if (!dealId) return;

    const userId = BigInt(ctx.from!.id);

    const result = await this.dispute.submitEvidence(dealId, userId, text);
    ctx.session.step = 'idle';

    if (result === 'arbitrating') {
      const loading = await ctx.reply(
        `📋 Evidence received. Both sides have submitted — running AI arbitration now...`,
      );

      setTimeout(async () => {
        const d = await this.dispute.findByDealId(dealId);
        if (d?.verdictJson) {
          const deal = await this.deals.findById(dealId);
          const verdict = d.verdictJson as any;
          const verdictText = this.arbitration.formatVerdict(verdict, deal!.amountTon);
          await ctx.api.deleteMessage(ctx.chat!.id, loading.message_id).catch(() => { });
          await this.notifications.onVerdictIssued(dealId, verdictText);
        }
      }, 15_000);
    } else {
      await ctx.reply(
        `📋 Evidence received.\n\nWaiting for the other party to submit their evidence.\n` +
        `The AI arbitrator will issue a verdict once both sides respond, ` +
        `or automatically after 24 hours.`,
      );
    }
  }

  private async resetFlow(ctx: BotContext) {
    ctx.session.step = 'idle';
    ctx.session.draftDeal = {};
    ctx.session.activeDealId = undefined;
    ctx.session.pendingWalletDealId = undefined;
  }

  private async showMyDeals(ctx: BotContext) {
    const userId = BigInt(ctx.from!.id);
    const dealList = await this.deals.findByUser(userId);

    if (!dealList.length) {
      await ctx.reply(
        `You have no deals yet.`,
        { reply_markup: new InlineKeyboard().text('➕ Create Deal', 'menu:new_deal') },
      );
      return;
    }

    let text = `📋 *Your deals:*\n\n`;
    const keyboard = new InlineKeyboard();

    for (const deal of dealList.slice(0, 8)) {
      const emoji = this.bot.statusEmoji(deal.status);
      const role = deal.creatorId === userId ? 'client' : 'executor';
      text += `${emoji} \`${deal.id.slice(0, 8)}\` · ${deal.amountTon} TON · ${role}\n`;
      keyboard.text(`${emoji} ${deal.id.slice(0, 8)}`, `view:${deal.id}`).row();
    }

    keyboard
      .text('➕ New Deal', 'menu:new_deal').row()
      .text('🏠 Main menu', 'menu:home');
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: keyboard });
  }

  private async showDeal(ctx: BotContext, dealId: string) {
    const userId = BigInt(ctx.from!.id);
    const deal = await this.deals.findById(dealId);
    if (!deal) { await ctx.reply('Deal not found.'); return; }

    const role = deal.creatorId === userId ? 'creator' : 'executor';
    const emoji = this.bot.statusEmoji(deal.status);
    const c = deal.contractJson as Record<string, any>;

    const botUsername = ctx.me.username;
    const inviteLink = this.buildInviteLink(botUsername, deal.inviteToken);

    let text =
      `${emoji} <b>Deal <code>${this.escapeHtml(dealId.slice(0, 8))}</code></b>\n\n` +
      `Status: <b>${this.escapeHtml(deal.status)}</b>\n` +
      `Amount: <b>${deal.amountTon} TON</b>\n` +
      `Your role: <b>${this.escapeHtml(role)}</b>\n`;

    if (deal.deadlineAt) {
      text += `Deadline: <b>${this.escapeHtml(new Date(deal.deadlineAt).toLocaleDateString())}</b>\n`;
    }

    if (c?.serviceType) {
      text += `\nService: ${this.escapeHtml(String(c.serviceType))}\n`;
    }

    if (role === 'creator') {
      text +=
        `\nInvite link:\n` +
        `<a href="${this.escapeHtml(inviteLink)}">${this.escapeHtml(inviteLink)}</a>\n`;
    }

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: this.bot.dealActions(dealId, role, deal.status),
    });
  }

  private async showWallet(ctx: BotContext) {
    const userId = BigInt(ctx.from!.id);
    const user = await this.users.findById(userId);

    if (!user?.walletAddress) {
      ctx.session.step = 'awaiting_wallet';
      ctx.session.pendingWalletDealId = undefined;

      await ctx.reply(
        `👛 <b>No wallet connected</b>\n\n` +
        `Send your TON wallet address (starts with EQ or UQ) to connect it.\n\n` +
        `Your wallet is needed for refunds and payments.`,
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard()
            .text('❌ Cancel', 'menu:home'),
        },
      );
      return;
    } else {
      await ctx.reply(
        `👛 *Your wallet*\n\n` +
        `\`${user.walletAddress}\`\n\n` +
        `Deals completed: ${user.dealsCount}`,
        {
          parse_mode: 'Markdown',
          reply_markup: new InlineKeyboard().text('🔄 Change wallet', 'wallet:set'),
        },
      );
    }
  }
}
