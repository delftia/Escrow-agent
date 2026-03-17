import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Bot, InlineKeyboard, session } from 'grammy';
import { BotContext, SessionData } from './bot.types';

@Injectable()
export class BotService implements OnModuleInit {
  private readonly logger = new Logger(BotService.name);
  public bot: Bot<BotContext>;

  onModuleInit() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');

    this.bot = new Bot<BotContext>(token);

    this.bot.use(
      session({
        initial: (): SessionData => ({
          step: 'idle',
          draftDeal: {},
        }),
      }),
    );

    this.bot.catch(async (err) => {
      const ctx = err.ctx;
      this.logger.error(`Bot middleware error while handling update ${ctx.update.update_id}`, err.error);
    
      try {
        if (ctx.chat?.id) {
          await ctx.reply('❌ Something went wrong. Please try again.');
        }
      } catch (replyErr) {
        this.logger.warn('Failed to send fallback error message', replyErr);
      }
    });

    this.bot.start({
      onStart: (info) => this.logger.log(`Bot @${info.username} started`),
    }).catch((err) => this.logger.error('Bot start error', err));
  }

  mainMenu(): InlineKeyboard {
    return new InlineKeyboard()
      .text('➕ New Deal', 'menu:new_deal').row()
      .text('📋 My Deals', 'menu:my_deals').row()
      .text('👛 My Wallet', 'menu:wallet').row()
      .text('❓ How it works', 'menu:help');
  }

  dealActions(dealId: string, role: 'creator' | 'executor', status: string): InlineKeyboard {
    const kb = new InlineKeyboard();

    if (status === 'AWAITING_PAYMENT' && role === 'creator') {
      kb.text('💎 Pay now', `pay:${dealId}`).row();
    }
    if (status === 'ACTIVE' && role === 'executor') {
      kb.text('📤 Submit Result', `submit:${dealId}`).row();
    }
    if (status === 'UNDER_REVIEW' && role === 'creator') {
      kb.text('✅ Confirm & Release', `complete:${dealId}`).row();
      kb.text('⚖️ Open Dispute', `dispute:${dealId}`).row();
    }

    kb.text('🔙 Back', 'menu:my_deals');
    return kb;
  }

  statusEmoji(status: string): string {
    const map: Record<string, string> = {
      DRAFT: '📝',
      NEGOTIATING: '🤝',
      AWAITING_PAYMENT: '💳',
      ACTIVE: '⚙️',
      UNDER_REVIEW: '🔍',
      DISPUTED: '⚖️',
      COMPLETED: '✅',
      PARTIALLY_RESOLVED: '🔶',
      REFUNDED: '↩️',
      CANCELED: '❌',
    };
    return map[status] ?? '❓';
  }
}
