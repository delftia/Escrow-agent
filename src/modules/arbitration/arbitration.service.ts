import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

export interface ArbitrationInput {
  contract: Record<string, any>;
  creatorEvidence: { text: string } | null;
  executorEvidence: { text: string } | null;
}

export interface ArbitrationVerdict {
  fulfilledCriteria: string[];
  unfulfilledCriteria: string[];
  executorSharePercent: number; // 0–100
  reasoning: string;
  confidence: number; // 0.0–1.0
}

const ARBITRATOR_PROMPT = `You are a neutral AI arbitrator resolving a payment dispute between two parties in a service deal.

Your job:
1. Read the original contract (what was agreed)
2. Read the client's complaint (what they say went wrong)
3. Read the executor's defense (what they say was delivered)
4. Decide what percentage of the payment the executor deserves

Rules:
- Be strictly neutral — do not favor either party
- Base your decision ONLY on the contract criteria vs submitted evidence
- If executor provided no evidence, lean toward creator
- If creator provided no evidence, lean toward executor
- Partial fulfillment = partial payment (use percentages like 0, 25, 50, 75, 100)
- Provide clear reasoning both parties can understand
- Respond ONLY with valid JSON, no markdown, no extra text

Output format:
{
  "fulfilled_criteria": ["criteria that were met"],
  "unfulfilled_criteria": ["criteria that were NOT met"],
  "executor_share_percent": number 0-100,
  "reasoning": "Clear explanation of the decision in 2-4 sentences",
  "confidence": number 0.0-1.0
}`;

@Injectable()
export class ArbitrationService {
  private readonly logger = new Logger(ArbitrationService.name);
  private readonly openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async arbitrate(input: ArbitrationInput): Promise<ArbitrationVerdict> {
    this.logger.log('Running AI arbitration...');

    const prompt = this.buildPrompt(input);

    try {
      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        temperature: 0.1, // low temperature = consistent, fair decisions
        messages: [
          { role: 'system', content: ARBITRATOR_PROMPT },
          { role: 'user', content: prompt },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw);

      const verdict: ArbitrationVerdict = {
        fulfilledCriteria: parsed.fulfilled_criteria ?? [],
        unfulfilledCriteria: parsed.unfulfilled_criteria ?? [],
        executorSharePercent: Math.min(100, Math.max(0, Number(parsed.executor_share_percent ?? 50))),
        reasoning: parsed.reasoning ?? 'Insufficient evidence to determine outcome.',
        confidence: Number(parsed.confidence ?? 0.5),
      };

      this.logger.log(
        `Verdict: executor gets ${verdict.executorSharePercent}% (confidence ${verdict.confidence})`,
      );

      return verdict;
    } catch (err) {
      this.logger.error('Arbitration AI error, defaulting to 50/50', err);
      // Safe fallback: 50/50 split if AI fails
      return {
        fulfilledCriteria: [],
        unfulfilledCriteria: [],
        executorSharePercent: 50,
        reasoning: 'Arbitration service was unable to process the dispute. Defaulting to 50/50 split.',
        confidence: 0.0,
      };
    }
  }

  /**
   * Format the verdict into a Telegram message
   */
  formatVerdict(verdict: ArbitrationVerdict, totalTon: number): string {
    const execAmt = ((totalTon * verdict.executorSharePercent) / 100).toFixed(2);
    const creatAmt = (totalTon - parseFloat(execAmt)).toFixed(2);

    const fulfilled =
      verdict.fulfilledCriteria.length > 0
        ? verdict.fulfilledCriteria.map((c) => `  ✅ ${c}`).join('\n')
        : '  — (none)';

    const unfulfilled =
      verdict.unfulfilledCriteria.length > 0
        ? verdict.unfulfilledCriteria.map((c) => `  ❌ ${c}`).join('\n')
        : '  — (none)';

    return (
      `⚖️ *AI Arbitration Verdict*\n\n` +
      `*Criteria fulfilled:*\n${fulfilled}\n\n` +
      `*Criteria not fulfilled:*\n${unfulfilled}\n\n` +
      `*Decision:*\n` +
      `  Executor receives: *${execAmt} TON* (${verdict.executorSharePercent}%)\n` +
      `  Client refunded: *${creatAmt} TON* (${100 - verdict.executorSharePercent}%)\n\n` +
      `*Reasoning:*\n_${verdict.reasoning}_\n\n` +
      `_AI confidence: ${Math.round(verdict.confidence * 100)}%_`
    );
  }

  private buildPrompt(input: ArbitrationInput): string {
    const { contract } = input;
    const deliverables = (contract.deliverables as string[])?.join('\n  - ') ?? '—';
    const criteria = (contract.acceptanceCriteria as string[])?.join('\n  - ') ?? '—';

    const creatorText = input.creatorEvidence?.text ?? 'No evidence submitted by client.';
    const executorText = input.executorEvidence?.text ?? 'No evidence submitted by executor.';

    return `
ORIGINAL CONTRACT
-----------------
Service: ${contract.serviceType}
Deliverables:
  - ${deliverables}
Acceptance Criteria:
  - ${criteria}

CLIENT COMPLAINT (what they say was NOT delivered):
${creatorText}

EXECUTOR DEFENSE (what they say WAS delivered):
${executorText}

Please analyze and issue a fair verdict.
    `.trim();
  }
}
