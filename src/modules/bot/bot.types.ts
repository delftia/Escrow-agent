import { Context, SessionFlavor } from 'grammy';

export interface DraftDeal {
  rawDescription?: string;
  enrichedText?: string;    // accumulated text with all clarifications
  contractJson?: Record<string, any>;
  amountTon?: number;
  deadlineHours?: number;
  pendingQuestion?: string; // current clarification question
}

export interface SessionData {
  step:
    | 'idle'
    | 'awaiting_description'
    | 'awaiting_clarification'
    | 'awaiting_dispute_evidence'
    | 'awaiting_wallet';
  draftDeal: DraftDeal;
  activeDealId?: string;
  pendingWalletDealId?: string;
}

export type BotContext = Context & SessionFlavor<SessionData>;
