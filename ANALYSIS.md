# Signal Data Analysis

## Overview

This document analyzes the data structure from OKX Signal endpoints to understand how to build a signal-based wallet scoring pipeline.

---

## 1. Filter Activity Overview (`filter-activity-overview`)

This endpoint returns **three interconnected data structures**:

### A. `activityList` - Latest Signals (Flat List)

Each item represents a **single signal event**:

```json
{
  "addressNum": 3,           // Number of wallets in this signal batch
  "batchId": 1765650227643,  // Unique batch identifier (also a timestamp!)
  "batchIndex": 0,           // Index within the batch (0 = first signal)
  "eventTime": 1765650227643,// When this signal occurred (ms)
  "expireStatus": 0,         // 0 = active, 1 = expired
  "holders": "876",          // Token holders at signal time
  "id": 66193,               // Unique signal ID
  "liquidity": "49136.11...",// Liquidity at signal time (USD)
  "mcap": "189085.71...",    // Market cap at signal time (USD)
  "price": "0.000189...",    // Token price at signal time
  "sellRatio": "0.9513",     // Sell pressure ratio
  "signalLabel": "1",        // 1=Smart Money, 2=Influencers, 3=Whales
  "tokenKey": "501!@#5q9bwAWb25x8m57mwp76UoMazYgs7MYRGDPprJfDawgr",
  "trend": 1,                // 1=BUY, 2=SELL
  "volume": "2368.06..."     // Trade volume in signal (USD)
}
```

**Key Insight**: `tokenKey` format is `{chainId}!@#{tokenAddress}`

### B. `overviewList` - Aggregated Token View

Groups all signals for the same token with performance metrics:

```json
{
  "tokenKey": "501!@#5q9bwAWb25x8m57mwp76UoMazYgs7MYRGDPprJfDawgr",
  
  // First Signal Times per label (Smart Money, Influencers, Whales)
  "fstList": ["1765518972601", "", "1765522622978"],  // [SM, Inf, Whale]
  
  // Max Increase Multipliers per label
  "mimList": ["11", "", "1"],  // Smart Money got 11x, Whales got 1x
  
  // Max Increase Percentages per label
  "mipList": ["1002.55%", "", "32.21%"],  // SM +1002%, Whales +32%
  
  "maxIncreaseMultiplier": "11",      // Best multiplier across all labels (e.g., 11x)
  "maxIncreasePercentage": "1002.55%",// Best % gain across all labels (e.g., 10.02x)
  "lastEventTime": 1765650227643,     // Most recent signal time
  "klineDefaultPeriod": "15m",        // Suggested chart interval (important for scoring!)
  
  // All signals for this token (chronological)
  "signals": [
    {
      "addressNum": 3,
      "batchId": 1765518972601,
      "batchIndex": 0,
      "eventTime": 1765518972601,
      "signalLabel": "1",  // 1 = Smart Money
      "price": "0.000041...",
      "mcap": "41223...",
      "volume": "754.85..."
      // ... same fields as activityList
    },
    // More signals...
  ]
}
```

**Key Insight**: `fstList`, `mimList`, `mipList` are arrays indexed by signal label:
- Index 0 = Smart Money (signalLabel=1)
- Index 1 = Influencers (signalLabel=2)  
- Index 2 = Whales (signalLabel=3)

### C. `tokenInfo` - Token Metadata

Keyed by `tokenKey`, provides detailed token information:

```json
{
  "501!@#5q9bwAWb25x8m57mwp76UoMazYgs7MYRGDPprJfDawgr": {
    // Chain info
    "chainId": "501",
    "chainLogo": "https://...", // logo for the chain
    "chainBWLogoUrl": "https://...", // logo in black and white for the chain
    "nativeTokenSymbol": "SOL", // Native chain token symbol
    "protocolId": "120596",  // DEX protocol (pump.fun, Raydium, etc.)
    
    // Token identity
    "tokenContractAddress": "5q9bwAWb25x8m57mwp76UoMazYgs7MYRGDPprJfDawgr",
    "tokenName": "opensouls",
    "tokenSymbol": "OPENSOULS",
    "tokenLogoUrl": "https://...",
    "tokenCreateTime": 1765518680000,  // Token creation timestamp
    
    // Current metrics
    "currentMcap": "159595.11...",
    "currentPrice": "0.00015960...",
    "currentHolders": "928",
    
    // Trading stats
    "txs": "4812",       // Total transactions
    "buyTxs": "2645",    // Buy transactions
    "sellTxs": "2167",   // Sell transactions
    "volume": "335145.29...",  // Total volume
    "top10HoldAmountPercentage": "23.4213",  // Top 10 holders %
    
    "t": []  // Tags array, currently empty
  }
}
```

---

## 2. Signal Detail (`signal-detail`)

Returns **wallet addresses** for a specific signal batch.

**Request Parameters:**
- `chainId`: Chain ID (501, 1, 56, 8453)
- `tokenContractAddress`: Token address (extracted from tokenKey)
- `batchId`: From activityList item
- `batchIndex`: From activityList item
- `t`: Current timestamp

**Response:**

```json
{
  "addresses": [
    {
      "walletAddress": "CZY8q2XxBV9PepUoeeRy18q9mqPWvGVZLMAaz2ZiEFJ6",
      
      // Alias (if set by OKX)
      "addressAlias": "",          // optional display name
      
      // Social/KOL info
      "addressInfo": {
        "avatarUrl": "",           // Profile picture URL
        "kolAddress": false,       // true if verified KOL
        "twitterHandle": ""        // Twitter username
      },
      
      // Performance metrics
      "pnl7d": "3333.23...",       // 7-day PnL in USD
      "roi": "4.216...",           // ROI percentage
      "winRate": "34.0708"         // Win rate percentage
    },
    {
      "walletAddress": "215nhcAHjQQGgwpQSJQ7zR26etbjjtVdW74NLzwEgQjP",
      "addressInfo": {
        "avatarUrl": "https://...", // Profile picture URL
        "kolAddress": true,         // This is a verified KOL!
        "twitterHandle": "OGAntD"   // Twitter: @OGAntD
      },
      "pnl7d": "-20286.05...",     // Negative = losing PnL
      "roi": "-14.90...",          // Negative = losing ROI
      "winRate": "36.8421"         // e.g., 36.84% win rate
    }
  ]
}
```

---

## 3. Combined Data Per Signal

By joining the data, we can construct a **rich signal object**:

### Per Signal Batch:

| Field | Source | Example |
|-------|--------|---------|
| **Signal ID** | `activityList.id` | 66193 |
| **Batch ID** | `activityList.batchId` | 1765650227643 |
| **Batch Index** | `activityList.batchIndex` | 0 |
| **Event Time** | `activityList.eventTime` | 1765650227643 (Dec 13, 2025) |
| **Trend** | `activityList.trend` | 1 (BUY) |
| **Signal Label** | `activityList.signalLabel` | "1" (Smart Money) |
| **Address Count** | `activityList.addressNum` | 3 |
| **Volume** | `activityList.volume` | $2,368.06 |

### Per Token (from `tokenInfo`):

| Field | Source | Example |
|-------|--------|---------|
| **Chain** | `tokenInfo.chainId` | 501 (Solana) |
| **Token Address** | `tokenInfo.tokenContractAddress` | 5q9bwAWb... |
| **Token Name** | `tokenInfo.tokenName` | opensouls |
| **Token Symbol** | `tokenInfo.tokenSymbol` | OPENSOULS |
| **Token Logo** | `tokenInfo.tokenLogoUrl` | https://... |
| **Token Age** | `now - tokenInfo.tokenCreateTime` | ~1.5 days |
| **Current Price** | `tokenInfo.currentPrice` | $0.00015960 |
| **Current MCap** | `tokenInfo.currentMcap` | $159,595 |
| **Current Holders** | `tokenInfo.currentHolders` | 928 |
| **Total Volume** | `tokenInfo.volume` | $335,145 |
| **Buy/Sell Txs** | `tokenInfo.buyTxs/sellTxs` | 2645/2167 |
| **Top 10 Hold %** | `tokenInfo.top10HoldAmountPercentage` | 23.42% |

### At Signal Time:

| Field | Source | Example |
|-------|--------|---------|
| **Price** | `activityList.price` | $0.000189 |
| **MCap** | `activityList.mcap` | $189,085 |
| **Liquidity** | `activityList.liquidity` | $49,136 |
| **Holders** | `activityList.holders` | 876 |
| **Sell Ratio** | `activityList.sellRatio` | 0.9513 (95% selling) |

### Token Performance (from `overviewList`):

| Field | Source | Example |
|-------|--------|---------|
| **Max Multiplier (All)** | `overviewList.maxIncreaseMultiplier` | 11x |
| **Max % Gain (All)** | `overviewList.maxIncreasePercentage` | +1002.55% |
| **Smart Money 1st Signal** | `overviewList.fstList[0]` | 1765518972601 |
| **Smart Money Max Mult** | `overviewList.mimList[0]` | 11x |
| **Whales 1st Signal** | `overviewList.fstList[2]` | 1765522622978 |
| **Whales Max Mult** | `overviewList.mimList[2]` | 1x |

### Per Wallet (from `signal-detail`):

| Field | Source | Example |
|-------|--------|---------|
| **Wallet Address** | `addresses[].walletAddress` | CZY8q2Xx... |
| **Is KOL** | `addresses[].addressInfo.kolAddress` | true/false |
| **Twitter** | `addresses[].addressInfo.twitterHandle` | @OGAntD |
| **Avatar** | `addresses[].addressInfo.avatarUrl` | https://... |
| **7d PnL** | `addresses[].pnl7d` | $3,333.23 |
| **ROI** | `addresses[].roi` | +4.21% |
| **Win Rate** | `addresses[].winRate` | 34.07% |

---

## 4. Data Extraction Functions

### Parse Token Key

```javascript
function parseTokenKey(tokenKey) {
  const [chainId, tokenAddress] = tokenKey.split('!@#');
  return { chainId: parseInt(chainId), tokenAddress };
}

// Example:
// parseTokenKey("501!@#5q9bwAWb25x8m57mwp76UoMazYgs7MYRGDPprJfDawgr")
// → { chainId: 501, tokenAddress: "5q9bwAWb25x8m57mwp76UoMazYgs7MYRGDPprJfDawgr" }
```

### Signal Label Names

```javascript
const SIGNAL_LABELS = {
  '1': 'Smart Money',
  '2': 'Influencers',
  '3': 'Whales'
};
```

### Trend Names

```javascript
const TRENDS = {
  1: 'BUY',
  2: 'SELL'
};
```

---

## 5. Pipeline Flow

```
1. Poll filter-activity-overview (every 30-60 seconds)
   ↓
2. Track seen batchIds to detect NEW signals
   ↓
3. For each NEW signal:
   a. Extract tokenAddress from tokenKey
   b. Get token metadata from tokenInfo[tokenKey]
   c. Call signal-detail to get wallet addresses
   ↓
4. For each wallet in signal:
   a. Run wallet scoring (reuse telegram-scorer logic)
   b. Aggregate entry quality scores
   ↓
5. Format output:
   - Signal summary (token, time, trend, label)
   - Token info (name, mcap, age, holders)
   - Wallet scores (per wallet: score, multiplier, PnL)
   ↓
6. Send to Telegram / Store wallet with score (and other data) in DB
```

---

## 6. Sample Combined Output

```
🔔 NEW SMART SIGNAL (SOL)

OPENSOULS ($OPENSOULS)
5q9bwAWb...
BUY (3) - Vol: $2,368.06 <- shorten info ("3" = number of wallets)

MC $159.6K 💦 $49K (-15.61%)
👤 876 (↘95.13%) <-- sell pressure is essentially holder share 
├ Smart Money: 11x (+1002.55%)
├ Whales: 1x (+32.21%)
└ KOL: N/A <-- no influencer in signal yet

Signal Wallets:

🧠 CZY8q2Xx... 🔵 (+1.2) <- Type symbols for Whale, Smart or Influencer as emoji
└ 7d: +$3.3K (+4.21%) WR: 34%

🐳 7mm8CRqj... 🟢 (+0.7)
└ 7d: +$0.73K (+8.38%) WR: 30%

🎤 @OGAntD 🔴 (-1.1)
└ 7d: -$20.3K (-14.9%) WR: 37%
```

- Note: Could write `Signal Quality: 🟡 Mixed` although it's rather a 🟢 positive with 🔵+🟢 against a 🔴 so the scores balance out to a 0.8 - should we use this metric?

---

## 7. Pagination

For continuous monitoring, use:

```javascript
// First request (no pagination)
{ "pageSize": 20 }

// Subsequent requests (load more)
{ 
  "pageSize": 20,
  "latestId": 66193,              // Last seen id
  "lastEventTime": 1765650227643  // Last seen eventTime
}
```

---

## 8. New Signal Detection

To detect new signals, track:

```javascript
const seenSignals = new Set();

function isNewSignal(activity) {
  const key = `${activity.batchId}-${activity.batchIndex}`;
  if (seenSignals.has(key)) return false;
  seenSignals.add(key);
  return true;
}
```

Or track by `id` which is unique per signal event. Probably best by `id` although we may want to utilize batching signals by token as well.