# Cron Tasks Implementation Plan

## Overview

Two new cron endpoints to enable signal performance tracking and data lifecycle management.

---

## 1. `/api/update-prices` - Performance Tracking Cron

**Purpose:** Fetch current prices for tracked tokens and update signal performance data.

### Schedule
- **Every 15 minutes** (matches common price update intervals)
- Vercel cron: `*/15 * * * *`

### Flow
```
1. Load all chain indexes (sol, eth, bsc, base)
2. For each chain with active tokens:
   a. Load token records from DB
   b. Batch fetch current prices (OKX candles or external API)
   c. For each token with recent signals (<24h):
      - Calculate multiplier: currentPrice / entryPrice
      - Update signal record with price snapshot
      - Determine outcome if 24h has passed
3. For significant gains (>2x or >50%):
   - Post performance update to public channel
4. Pin updated indexes
```

### Price Data Source Options
1. **OKX Candles API** (already have) - Best for consistency
2. **DexScreener API** - Free, real-time
3. **Birdeye/Jupiter** - Solana-specific

### Performance Update Message Format
```
📊 Signal Performance Update

🪙 TOKEN (SOL) 🔄 3x signals

Original: $0.00123 → Now: $0.00369
Multiplier: 3.0x 🚀

First signal: 12h ago (Smart Money)
Avg entry score: +0.85 ⭐
```

### Implementation Priority
- [ ] Create `/api/update-prices.js` endpoint
- [ ] Add price fetching utility (DexScreener first - free & simple)
- [ ] Add signal price snapshot updates
- [ ] Add performance message posting
- [ ] Add to vercel.json crons

---

## 2. `/api/cleanup` - Data Lifecycle Cron

**Purpose:** Archive expired records and maintain database health.

### Schedule
- **Daily at 04:00 UTC** (low activity period)
- Vercel cron: `0 4 * * *`

### Flow
```
1. For each chain (sol, eth, bsc, base):
   a. Load index from pinned message
   b. Scan signals channel for expired records (>7d)
      - Archive to archive channel
      - Delete original message
      - Update index stats
   c. Scan tokens channel for expired records (>30d)
      - Archive with aggregated stats
      - Delete original
   d. Scan wallets channel for expired records
      - Score >= 0.5: keep 30d
      - Score < 0.5: keep 7d
      - Archive and delete expired
   e. Aggregate stats to index
   f. Pin updated index
2. Log cleanup summary
```

### Archive Message Format
```
#archived_signals
#reason_expired
{"_archived":1766..., "_reason":"expired", ...originalRecord}
```

### Implementation Priority
- [ ] Create `/api/cleanup.js` endpoint
- [ ] Add channel message scanning (via recent messages or tracking)
- [ ] Add archive-and-delete flow
- [ ] Add index stats aggregation
- [ ] Add to vercel.json crons

---

## 3. Vercel Cron Configuration

Add to `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/poll-solana", "schedule": "* * * * *" },
    { "path": "/api/poll-eth", "schedule": "*/2 * * * *" },
    { "path": "/api/poll-bsc", "schedule": "*/3 * * * *" },
    { "path": "/api/poll-base", "schedule": "*/4 * * * *" },
    { "path": "/api/update-prices", "schedule": "*/15 * * * *" },
    { "path": "/api/cleanup", "schedule": "0 4 * * *" }
  ]
}
```

---

## 4. Price Fetching Utility

### DexScreener API (Recommended - Free)
```javascript
// lib/price-fetcher.js
const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex/tokens/';

async function getTokenPrice(chainId, tokenAddress) {
  const chainMap = {
    501: 'solana',
    1: 'ethereum', 
    56: 'bsc',
    8453: 'base'
  };
  
  const res = await fetch(`${DEXSCREENER_API}${tokenAddress}`);
  const data = await res.json();
  
  if (data.pairs && data.pairs.length > 0) {
    // Get the pair with highest liquidity on the right chain
    const pair = data.pairs.find(p => p.chainId === chainMap[chainId]);
    return pair ? parseFloat(pair.priceUsd) : null;
  }
  return null;
}
```

---

## 5. Execution Order

### Phase 1: Performance Tracking (Higher Value)
1. Create `lib/price-fetcher.js`
2. Create `/api/update-prices.js`
3. Test locally with a few tokens
4. Deploy and enable cron

### Phase 2: Cleanup System
1. Create `/api/cleanup.js`
2. Test archiving logic
3. Deploy and enable cron

---

## 6. Considerations

### Rate Limits
- DexScreener: ~300 requests/min (should be fine)
- Telegram: 30 messages/sec (won't hit this)

### Cold Start Handling
- Both crons load index from pinned message
- No state needed between invocations

### Error Handling
- Failures should not crash the cron
- Log errors, continue with next token/record
- Retry logic optional (next cron run will retry)

### Cost
- Vercel Hobby: Crons run max 1x/hour on free tier
- Vercel Pro: Full cron support
- Consider: Combine update-prices into poll endpoints if needed
