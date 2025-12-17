# Signal Pipeline

OKX Smart Money Signal Monitor - Posts signals to Telegram with wallet scoring.

## Features

- Polls OKX for Smart Money / Influencers / Whales signals
- Scores wallet entry quality (8h lookback, 24h lookforward)
- Posts formatted messages with:
  - Token links (Solscan, DexTools, DexScreener)
  - Signal stats (MCap, Volume, Max Gain)
  - Wallet details with entry scores
  - OKX metrics (PnL, ROI, Win Rate)

## Deployment

### 1. Deploy to Vercel

```bash
cd signal-pipeline
vercel
```

Or connect via GitHub and set root directory to `signal-pipeline`.

### 2. Set Environment Variables in Vercel

| Variable | Value |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Channel/group ID (e.g., `-1003474351030`) |

### 3. Set up External Cron

Use [cron-job.org](https://cron-job.org) (free) to ping the endpoint every minute:

- **URL**: `https://your-app.vercel.app/api/poll`
- **Interval**: 1 minute
- **Method**: GET

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/poll` | GET | Polls OKX for new signals, posts to Telegram |
| `/api/health` | GET | Health check |

## Message Format

```
🚨 Smart Money 🟢 BUY

🪙 TokenName (SYMBOL)
tokenContractAddress
Solana | 4.6d | DexT | DexS

MCap: +$1.3M | Vol: +$633
5 wallets | 19x (+1.86K%)

Signal Wallets:

CuwxHw...z9vC 🟠 -0.67 avg
PnL +$10.5K | ROI +5.0% | WR 60%

6thKzh...4nVi 🔵 2.00 avg ✨
PnL +$327 | ROI +0.5% | WR 63%

2025-12-17 11:47:05 UTC
```

## Local Testing

```bash
# Create .env with your credentials
echo "TELEGRAM_BOT_TOKEN=your_token" > .env
echo "TELEGRAM_CHAT_ID=your_chat_id" >> .env

# Run test
node test.js
```

## Scoring Legend

| Emoji | Score Range | Meaning |
|-------|-------------|---------|
| 🔵 | ≥ 1.5 | Excellent entry timing |
| 🟢 | ≥ 0.5 | Good entry timing |
| ⚪️ | -0.5 to 0.5 | Neutral |
| 🟠 | -1.5 to -0.5 | Poor entry timing |
| 🔴 | < -1.5 | Bad entry timing |
| ✨ | ≥ 0.5 | Highlighted as quality wallet |
