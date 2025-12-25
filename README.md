# Signal Pipeline

OKX Smart Money Signal Monitor - Posts signals to Telegram with wallet scoring.

## Architecture

See `docs/FILE-DB-V5-FINAL.md` for complete system documentation.

```
┌─────────────────────────────────────────────────────────────────┐
│  POLLING (api/poll-*.js) → DATABASE (lib/telegram-db-v5.js)    │
│                                    │                            │
│  UPDATES                           ▼                            │
│  ├─ update-prices.js    →  PRIVATE: -1003474351030 (full)      │
│  └─ update-leaderboard.js →  PUBLIC: -1003627230339 (redacted) │
└─────────────────────────────────────────────────────────────────┘
```

## Channels

| Channel | ID | Purpose |
|---------|-----|---------|
| **PRIVATE** | `-1003474351030` | Full signals, full leaderboards |
| **PUBLIC** | `-1003627230339` | Redacted signals, redacted leaderboards |
| db-sol | `-1003359608037` | SOL database file |
| db-eth | `-1003584605646` | ETH database file |
| db-bsc | `-1003672339048` | BSC database file |
| db-base | `-1003269677620` | BASE database file |
| archive | `-1003645445736` | Archived data |

## Endpoints

| Endpoint | Cron | Description |
|----------|------|-------------|
| `/api/poll-solana` | 2 min | Poll SOL signals |
| `/api/poll-eth` | 5 min | Poll ETH signals |
| `/api/poll-bsc` | 5 min | Poll BSC signals |
| `/api/poll-base` | 5 min | Poll Base signals |
| `/api/update-prices` | 15 min | Track performance |
| `/api/update-leaderboard` | 30 min | Update pinned leaderboards |
| `/api/health` | - | Health check |

## Deployment

```bash
cd signal-pipeline
vercel --prod
```

### Environment Variables (Vercel)

| Variable | Value |
|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Private channel ID |
| `USE_TELEGRAM_DB` | `true` |

### Cron Setup (cron-job.org)

Set up external cron for each endpoint with appropriate intervals.

## File Structure

```
signal-pipeline/
├── api/
│   ├── poll-solana.js       # SOL signal polling
│   ├── poll-eth.js          # ETH signal polling
│   ├── poll-bsc.js          # BSC signal polling
│   ├── poll-base.js         # Base signal polling
│   ├── update-prices.js     # Price/performance tracking
│   ├── update-leaderboard.js # Leaderboard updates
│   └── health.js            # Health check
├── lib/
│   ├── telegram-db-v5.js    # File-based DB (current)
│   ├── db-integration-v5.js # DB wrapper
│   └── price-fetcher.js     # DexScreener prices
├── docs/
│   └── FILE-DB-V5-FINAL.md  # Full documentation
├── _archive/                 # Old test scripts (gitignored)
├── index.js                  # Main signal processing
└── vercel.json              # Vercel config
```

## Leaderboards

Both channels have 2 pinned messages (updated via edit):
1. **Token Leaderboard** - Top 15 trending tokens
2. **Wallet Leaderboard** - Top 15 wallets (7d performance)

**Private:** Full wallet addresses
**Public:** Redacted addresses (0x1a...3f4d)

## Scoring Legend

| Emoji | Score Range | Meaning |
|-------|-------------|---------|
| 🔵 | ≥ 1.5 | Excellent entry timing |
| 🟢 | ≥ 0.5 | Good entry timing |
| ⚪️ | -0.5 to 0.5 | Neutral |
| 🟠 | -1.5 to -0.5 | Poor entry timing |
| 🔴 | < -1.5 | Bad entry timing |
| ✨ | ≥ 0.5 | Highlighted as quality wallet |
| ⭐⭐⭐ | Elite | 70%+ win rate, 2x+ avg peak |
| ⭐⭐ | Good | 50%+ win rate |
| ⭐ | Decent | 30%+ win rate |
