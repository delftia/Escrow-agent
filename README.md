# TrustDeal

**AI Escrow & Arbitration Agent on TON**

> TON AI Agent Hackathon 2026 — Track: User-Facing AI Agents

---

## What is it?

TrustDeal is a Telegram bot that lets two people make a safe p2p deal:

1. The creator describes the deal in plain text → AI structures the contract
2. The executor gets an invite link and confirms the terms
3. The creator pays TON → funds are locked in escrow
4. Executor delivers → creator confirms → funds released
5. If there's a dispute → AI arbitrator analyzes evidence → funds split automatically

**Stack:** Telegram + AI (GPT-4o) + TON (@ton/mcp)

---

## Quick Start

### Step 1 — Set up credentials

```bash
cp .env.example .env
```

Fill in `.env`:
- `TELEGRAM_BOT_TOKEN` — from [@BotFather](https://t.me/BotFather)
- `OPENAI_API_KEY` — from [platform.openai.com](https://platform.openai.com)
- `MNEMONIC` — 24-word mnemonic of a **dedicated escrow wallet** (not your personal wallet)
- `TON_NETWORK` — use `testnet` for development

### Step 2 — Get the agentic wallet address

Run @ton/mcp once to deploy the agentic wallet and get its address:

```bash
MNEMONIC="your 24 words here" \
WALLET_VERSION=agentic \
npx @ton/mcp@alpha
```

It will print something like:
```
Agentic wallet address: EQAbCd1234...
Send TON to this address to activate it.
```

Set that address as `AGENTIC_WALLET_ADDRESS` in `.env`.
Then send 0.5 TON to that address to activate it (needed for outgoing transactions).

### Step 3 — Start everything

```bash
docker-compose up -d
```

This starts:
- `app` — NestJS backend + Telegram bot
- `ton-mcp` — @ton/mcp HTTP server on port 3001 (holds private key)
- `postgres` — database
- `redis` — job queue

Migrations run automatically on startup.

---

## Local Development (without Docker)

```bash
# Install dependencies
npm install

# Start PostgreSQL and Redis locally (or via docker)
docker-compose up postgres redis -d

# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:migrate

# Start @ton/mcp in a separate terminal
MNEMONIC="your 24 words" \
WALLET_VERSION=agentic \
AGENTIC_WALLET_ADDRESS=EQ... \
npx @ton/mcp@alpha --http 3001

# Start the app
npm run start:dev
```

---

## How the escrow works (Variant A)

```
User pays TON
    ↓
Funds land on the Agentic Wallet (your escrow wallet)
    ↓
Backend detects the incoming tx via Toncenter API
(matches by comment "trustdeal:<dealId>" + amount)
    ↓
Deal status → ACTIVE, executor is notified
    ↓
[Happy path] Creator confirms work
    → @ton/mcp sends full amount to executor

[Dispute] AI arbitrator runs
    → @ton/mcp splits: X% to executor, (100-X)% to creator
```

**Important:** Variant A uses a centralized escrow wallet. This means:
- All funds are held by the bot operator
- If the server is compromised, funds are at risk
- This is acceptable for hackathon MVP

**V2 plan:** Replace with a Tact smart contract for trustless on-chain escrow.

---

## Project Structure

```
src/
├── modules/
│   ├── bot/            # Telegram bot (grammy) — all user interaction
│   │   ├── bot.service.ts    # Bot setup, keyboards
│   │   ├── bot.update.ts     # All command/callback handlers
│   │   └── bot.types.ts      # Session types
│   ├── user/           # User registration, wallet management
│   ├── deal/           # Deal CRUD + lifecycle transitions
│   ├── intent/         # AI: parse user text → structured contract
│   ├── contract/       # Contract formatting + validation
│   ├── ton/            # @ton/mcp HTTP wrapper
│   ├── payment/        # Escrow lock, release, split
│   ├── dispute/        # Open dispute, collect evidence, run arbitration
│   ├── arbitration/    # AI arbitrator (GPT-4o judge)
│   ├── notification/   # User notifications + deadline cron jobs
│   └── queue/          # BullMQ: payment polling queue
├── database/           # Prisma service
└── main.ts
```

---

## Deal Flow (technical)

```
/start
  → upsert user
  → show main menu

[New Deal]
  → user writes description
  → IntentService.parse() → GPT-4o → structured contract JSON
  → if missing info → ask clarifying question → re-parse
  → show contract preview
  → user confirms → Deal created (status: NEGOTIATING)
  → invite link generated

[Executor opens invite link]
  → /start invite_TOKEN
  → show deal summary
  → executor taps "Accept"
  → deal.executorId set, status → AWAITING_PAYMENT
  → creator notified

[Creator pays]
  → payment link generated (ton:// deeplink with amount+comment)
  → user taps "I paid"
  → BullMQ job polls Toncenter every 15s for up to 15min
  → tx found → status → ACTIVE, both notified

[Executor submits]
  → status → UNDER_REVIEW
  → creator notified with confirm/dispute buttons

[Creator confirms]
  → PaymentService.releaseToExecutor()
  → @ton/mcp sends full amount
  → status → COMPLETED

[Dispute]
  → status → DISPUTED
  → both sides submit evidence as text
  → when both submitted (or 24h timeout) → AI arbitration
  → ArbitrationService.arbitrate() → GPT-4o verdict
  → PaymentService.splitPayment() → @ton/mcp does two transfers
  → status → PARTIALLY_RESOLVED / COMPLETED / REFUNDED
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | From @BotFather |
| `OPENAI_API_KEY` | ✅ | OpenAI API key |
| `MNEMONIC` | ✅ | 24-word escrow wallet mnemonic |
| `WALLET_VERSION` | ✅ | Set to `agentic` |
| `AGENTIC_WALLET_ADDRESS` | ✅ | Deployed agentic wallet address |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_HOST` | ✅ | Redis host |
| `TON_NETWORK` | ✅ | `testnet` or `mainnet` |
| `TONCENTER_API_KEY` | ❌ | Optional, for higher rate limits |
| `OPENAI_MODEL` | ❌ | Default: `gpt-4o` |

---

## License

MIT
