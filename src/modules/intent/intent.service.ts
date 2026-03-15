import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

export interface ParsedIntent {
  contract: {
    serviceType: string;
    deliverables: string[];
    acceptanceCriteria: string[];
  };
  amountTon: number;
  deadlineHours: number;
  missingInfo: string[];
}

const SYSTEM_PROMPT = `You are a legal assistant helping to structure service deal contracts between two parties on Telegram.

Extract deal details from the user message and return structured JSON.

Rules:
- Extract: service type, deliverables, amount in TON, deadline in hours, acceptance criteria
- Deliverables must be specific and measurable (not vague)
- Acceptance criteria = how the client will verify the work is done
- If TON amount is missing → add "What is the payment amount in TON?" to missing_info
- If deadline is missing → default to 72 hours, do NOT ask
- Ask only 1-2 most important missing things at a time
- Respond ONLY with valid JSON, no markdown, no extra text

Output format:
{
  "contract": {
    "serviceType": "string",
    "deliverables": ["specific deliverable 1", "specific deliverable 2"],
    "acceptanceCriteria": ["measurable criterion 1", "measurable criterion 2"]
  },
  "amount_ton": number,
  "deadline_hours": number,
  "missing_info": ["question if needed"]
}`;

@Injectable()
export class IntentService {
  private readonly logger = new Logger(IntentService.name);
  private readonly openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async parse(userText: string): Promise<ParsedIntent> {
    try {
      const response = await this.openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userText },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw);

      return {
        contract: parsed.contract ?? {
          serviceType: 'Service',
          deliverables: [],
          acceptanceCriteria: [],
        },
        amountTon: Number(parsed.amount_ton ?? 0),
        deadlineHours: Number(parsed.deadline_hours ?? 72),
        missingInfo: Array.isArray(parsed.missing_info) ? parsed.missing_info : [],
      };
    } catch (err) {
      this.logger.error('Intent parse error', err);
      return {
        contract: { serviceType: 'Unknown', deliverables: [], acceptanceCriteria: [] },
        amountTon: 0,
        deadlineHours: 72,
        missingInfo: ['Could you describe the deal in more detail?'],
      };
    }
  }
}
