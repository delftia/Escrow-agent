# 🚀 TrustDeal

**AI-powered escrow & arbitration bot on TON**

> Built for TON AI Agent Hackathon 2026

---

## 🔗 Links

🎥 Demo video: https://drive.google.com/file/d/1kjmI2JP1IgEASweMIe9s7F6BIHct_lpR/view  
🤖 Try the bot: https://t.me/trust_deal_contest_bot  

---

## 🧠 What makes it special

TrustDeal is not just a bot — it's a **complete deal system**:

- AI converts plain text → structured contract  
- TON escrow secures funds  
- AI resolves disputes automatically  

👉 I intentionally chose this architecture to combine:
- real blockchain utility  
- clear UX  
- automated trust  

---

## ⚙️ How it works

1. User describes a deal → AI builds contract  
2. Executor joins via invite link  
3. Client locks TON in escrow  
4. Work is delivered → confirmed → funds released  
5. If conflict → AI arbitrates → funds split  

---

## 💡 Key design decisions

### 🔐 Centralized escrow (MVP)
Used an agentic wallet (@ton/mcp)

Why:
- faster to build  
- easier UX  
- reliable for demo  

---

### 🤖 AI-first UX
Users just write naturally instead of filling forms

---

### 🔄 Queue-based verification
Blockchain polling runs in background (BullMQ)

---

### ⚖️ AI arbitration
GPT analyzes contract + evidence → makes decision

---

## 🧪 Demo mode

- payments are simulated  
- logic stays identical  
- no real TON needed  

---

## 🏗️ Stack

- Telegram (grammy)  
- NestJS  
- OpenAI (GPT-4o)  
- TON (@ton/mcp)  
- PostgreSQL + Prisma  
- Redis + BullMQ  

---

## 🚀 Run

```bash
cp .env.example .env  
docker-compose up -d  
```

## Local Development (without Docker)

```bash
npm install
docker-compose up postgres redis -d
npm run prisma:generate
npm run prisma:migrate

# Start @ton/mcp in a separate terminal
MNEMONIC="your 24 words" \
WALLET_VERSION=agentic \
AGENTIC_WALLET_ADDRESS=EQ... \
npx @ton/mcp@alpha --http 3001

npm run start:dev
```

---

## 📦 Why this matters

Freelance deals lack trust.

TrustDeal solves it with:
- escrow  
- AI contracts  
- AI arbitration  

👉 This is a real product, not just a demo.

---

## 🔮 Next

- smart contract escrow  
- non-custodial system  

---

## 🟢 Summary

- Real TON integration  
- Real AI usage  
- Full deal lifecycle  
- Production-ready base  
