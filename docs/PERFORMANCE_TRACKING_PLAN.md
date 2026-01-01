# Performance Tracking System - Analysis & Implementation Plan

> **Date:** 2025-01-01  
> **Status:** Planning Phase (Approved Parameters)  
> **Author:** Copilot Analysis

---

## 0. Confirmed Parameters

| Parameter | Value |
|-----------|-------|
| **Stop-Loss** | -35% |
| **Win Threshold** | ≥1.0x (any profit) |
| **Peak Tiers** | 1.5x, 2x, 5x, 10x (for reporting) |
| **Reset Time** | UTC midnight |
| **History Depth** | 24h, 7d, 4w, 12m (per chain + combined) |
| **Per-chain + Combined** | Both |

---

## 1. Current System Analysis

### 1.1 Existing Data Flow

```
Signal Detected → Stored in DB → Price Updates (15min) → Leaderboard Updates (30min)
```

#### Signal Storage (per token in `tokens` object):
```javascript
{
  sym: "TOKEN",           // Symbol
  p0: 0.001,              // Entry price (first signal)
  pNow: 0.002,            // Current price
  pPeak: 0.003,           // All-time high since signal
  pLow: 0.0008,           // All-time low since signal
  mult: 2.0,              // Current multiplier (pNow / p0)
  peakMult: 3.0,          // Peak multiplier (pPeak / p0)
  firstSeen: 1735600000,  // First signal timestamp
  lastSig: 1735700000,    // Last signal timestamp
  scnt: 3,                // Signal count
  wallets: ["0x..."],     // Unique wallets
  avgScr: 1.2,            // Average entry score
  lastMsgId: 1234,        // Private channel message ID
  publicMsgId: 5678,      // Public channel message ID
  rugged: false,          // Is token rugged?
  archived: false,        // Is token archived?
}
```

### 1.2 Identified Issues

#### Issue #1: Leaderboard vs Performance Metrics Mismatch

| Metric | Performance Update (`update-prices.js`) | Leaderboard (`telegram-db-v5.js`) |
|--------|----------------------------------------|----------------------------------|
| **Multiplier Used** | `currentMultiplier` = pNow / p0 | `token.mult` (same, but ranking uses `peakMult` sometimes) |
| **Filter** | Reports if new ATH or new ATL | Only shows tokens with `mult >= 1.0` |
| **Source** | Real-time DexScreener prices | Stored DB values (may be stale) |

**Problem:** The leaderboard uses stored `mult` values which are updated by `update-prices.js`. But if `update-prices` runs after `update-leaderboard`, the leaderboard shows stale data.

**Current Schedule:**
- `update-prices`: Every 15 minutes
- `update-leaderboard`: Every 30 minutes

**Fix:** Either:
1. Run leaderboard AFTER prices update completes, OR
2. Have `update-prices` call leaderboard update at the end

#### Issue #2: No Aggregate Statistics Tracked

Currently we calculate stats **on-the-fly** during formatting but don't persist them:
- Total gains (sum of all `mult-1` percentages)
- Win rate (count of `mult >= 1.0` / total)
- ROI with stop-loss consideration

**Missing:**
- Daily/Weekly aggregates
- Historical performance tracking
- Stop-loss adjusted ROI

#### Issue #3: No Proper "Peak Gains" Tracking for Closed Positions

When a token is archived (rugged, 50% drop from ATH, or time limit), we don't record its **final performance** anywhere persistent. We only have live tracking.

---

## 2. Proposed Solution Architecture

### 2.1 New Data Structure: `stats` Object in DB

Add to the chain database (`sol-db.json`, etc.):

```javascript
{
  version: 5,
  tokens: {...},
  wallets: {...},
  recentSignals: [...],
  
  // NEW: Aggregate performance stats
  stats: {
    // Lifetime totals (all time)
    lifetime: {
      totalSignals: 0,
      totalTokens: 0,
      totalPeakGainsPct: 0,    // Sum of all peak percentages (wins only)
      totalLossesPct: 0,       // Sum of all loss percentages (capped at -35%)
      wins: 0,                  // Tokens that hit >= 1.0x
      losses: 0,                // Tokens that never hit 1.0x and archived
      rugs: 0,                  // Tokens flagged as rugged
      // Peak tier counts
      peaked1_5x: 0,            // Hit 1.5x+
      peaked2x: 0,              // Hit 2x+
      peaked5x: 0,              // Hit 5x+
      peaked10x: 0,             // Hit 10x+
    },
    
    // Rolling periods (reset at UTC midnight)
    daily: {
      date: "2026-01-01",       // Current period date
      signals: 0,
      tokens: 0,
      peakGainsPct: 0,
      lossesPct: 0,
      wins: 0,
      losses: 0,
      rugs: 0,
      peaked1_5x: 0,
      peaked2x: 0,
      peaked5x: 0,
      peaked10x: 0,
    },
    
    weekly: {
      weekStart: "2025-12-30",  // Monday of current week
      signals: 0,
      tokens: 0,
      peakGainsPct: 0,
      lossesPct: 0,
      wins: 0,
      losses: 0,
      rugs: 0,
      peaked1_5x: 0,
      peaked2x: 0,
      peaked5x: 0,
      peaked10x: 0,
    },
    
    monthly: {
      month: "2026-01",         // Current month
      signals: 0,
      tokens: 0,
      peakGainsPct: 0,
      lossesPct: 0,
      wins: 0,
      losses: 0,
      rugs: 0,
      peaked1_5x: 0,
      peaked2x: 0,
      peaked5x: 0,
      peaked10x: 0,
    },
    
    // History arrays (for trends)
    history: {
      daily: [],   // Last 7 days [{date, signals, tokens, gainsPct, lossesPct, wins, losses, winRate, adjustedROI}]
      weekly: [],  // Last 4 weeks
      monthly: [], // Last 12 months
    },
    
    lastUpdated: 1735600000,
  }
}
```

### 2.2 New Calculation Logic

#### Gain Calculation (Signal → Peak)
```javascript
// When a token is finalized (archived or rugged)
const peakGain = token.peakMult >= 1.0 
  ? (token.peakMult - 1) * 100  // e.g., 2.5x → +150%
  : 0;  // Never use negative for gains

const isWin = token.peakMult >= 1.0;  // Any profit = win
const isLoss = token.peakMult < 1.0;  // Never profitable
const isRug = token.rugged;

// Peak tier tracking
const hit1_5x = token.peakMult >= 1.5;
const hit2x = token.peakMult >= 2.0;
const hit5x = token.peakMult >= 5.0;
const hit10x = token.peakMult >= 10.0;
```

#### Stop-Loss Adjusted ROI
```javascript
// Theoretical ROI assuming -35% stop loss
const STOP_LOSS_PCT = -35;

// For each finalized token:
const result = isWin ? peakGain : STOP_LOSS_PCT;  // Max profit or capped loss

// Aggregate ROI
const adjustedROI = (totalWinGains + (losses * STOP_LOSS_PCT)) / totalTrades;
```

#### Win Rate
```javascript
const winRate = wins / (wins + losses) * 100;
// Note: Rugs count as losses
```

#### Journey Tracking (Logged, Not Displayed)
```javascript
// Token recovered from dip to achieve peak
token.hitPeakAfterDip: true if (lowMult <= 0.65 && peakMult >= 1.0)

// Token peaked then dumped (pump & dump pattern)
token.dippedAfterPeak: true if (peakMult >= 1.5 && currentMult < 1.0)
```

### 2.3 Data Collection Points

| Event | Action |
|-------|--------|
| New signal stored | Increment `signals`, `tokens` (if new) |
| Token archived (profit) | Record peak gain, increment `wins` |
| Token archived (loss) | Record as -25% loss, increment `losses` |
| Token rugged | Record as -100% (or -25% SL), increment `rugs`, `losses` |
| Daily rollover (00:00 UTC) | Save daily to history, reset daily counters |
| Weekly rollover (Sunday 00:00 UTC) | Save weekly to history, reset weekly counters |

---

## 3. Pinned Summary Message Format

Update the pinned summary to include stats section:

```
📊 Stats & Info

Private smart money signal feed across 4 chains. See wallet addresses, 
explorer links, detailed analytics and more!

━━━━━━ PERFORMANCE ━━━━━━

📈 Today (2026-01-01)
• Signals: 15 | Tokens: 8
• Peak Gains: +847% (5 wins)
• Losses: 3 @ -35% SL = -105%
• Net ROI: +96.5% | Win Rate: 62.5%
• Peaks: 2x 1.5x • 1x 2x • 1x 5x

📅 This Week
• Signals: 87 | Tokens: 42
• Peak Gains: +4,231% | Losses: -525%
• Net ROI: +78.2% | Win Rate: 58.3%

📆 This Month
• Signals: 156 | Tokens: 89
• Peak Gains: +8,450% | Losses: -1,085%
• Net ROI: +65.4% | Win Rate: 55.8%

🏆 All Time
• Signals: 340 | Tokens: 156
• Peak Gains: +12,847% | Losses: -2,345%
• Net ROI: +61.2% | Win Rate: 54.2%
• Peak Highlights: 3x 10x • 8x 5x • 22x 2x

━━━━━ LEADERBOARDS ━━━━━

🟣 SOL: Tokens • Wallets
🔷 ETH: Tokens • Wallets
🔶 BSC: Tokens • Wallets
🔵 BASE: Tokens • Wallets

🎯 Signal Scoring:
🔵 Excellent | 🟢 Good | ⚪️ Neutral | 🟠 Weak | 🔴 Poor

━━━━━━━━━━━━━━━━━━
Leaderboards update live
```

---

## 4. Implementation Tasks

### Phase 1: Database Schema Update
1. Add `stats` object to `TelegramDBv5` with `initStats()` method
2. Add helper methods: `recordSignal()`, `finalizeToken()`, `rolloverDaily()`, `rolloverWeekly()`
3. Migrate existing databases to include stats

### Phase 2: Collection Integration
1. Modify `storeSignalData()` in `db-integration-v5.js` to call `recordSignal()`
2. Modify `update-prices.js` to call `finalizeToken()` when archiving
3. Add rollover logic to `update-prices.js` (check if new day/week)

### Phase 3: Display Integration
1. Update `formatSummaryMessage()` to include stats section
2. Add stats to performance update messages
3. Create new `/api/update-stats` endpoint for manual recalculation

### Phase 4: Historical Tracking
1. Store daily/weekly history in stats object
2. Add `/api/get-stats` endpoint for dashboard access
3. Consider separate stats document for long-term archival

---

## 5. Verification Checklist

Before implementation, verify:

- [ ] `update-prices.js` correctly updates all token fields (`pNow`, `pPeak`, `mult`, `peakMult`)
- [ ] Archive logic correctly triggers for all conditions (rug, 50% drop, time limit)
- [ ] `update-leaderboard.js` runs AFTER `update-prices.js` in cron schedule
- [ ] Stats object persists correctly through save/load cycle
- [ ] Rollover logic handles timezone correctly (UTC)
- [ ] Edge cases: token with 0 signals, wallet with 0 tokens, etc.

---

## 6. Identified Issues & Fixes Applied

### Issue #1: Chart Not Plotting Historical Signals ✅ FIXED

**Problem:** The `getTokenEnhancement()` function didn't return `firstSeen`, `lastSig`, or `signals` array, so the chart code couldn't plot previous signals.

**Fix Applied:** Updated `getTokenEnhancement()` to return:
- `firstSeen` - First signal timestamp
- `lastSig` - Last signal timestamp  
- `signals` - Array of `{time, price, score}` for each signal

Also added signal history tracking in `storeSignalData()` to populate the `signals` array.

### Issue #2: Slippage Not Logged ✅ FIXED

**Problem:** No tracking of price difference between OKX signal price and our processed price.

**Fix Applied:** Added slippage logging in `storeSignalData()` when slippage exceeds 0.1%.

### Issue #3: Journey Tracking Not Implemented ✅ FIXED

**Problem:** No tracking of whether token recovered from dip or dumped after peak.

**Fix Applied:** Added in `update-prices.js`:
- `hitPeakAfterDip`: True if went below -35% then recovered to profit
- `dippedAfterPeak`: True if achieved 1.5x+ then dumped below entry

### Issue #4: Font Rendering (Squares) - NOT FIXED

**Problem:** Text renders as `□` squares on Vercel due to font registration issues.

**Root Cause:** The `canvas` package on Vercel/Lambda cannot properly load fonts due to:
1. `Fontconfig error: Cannot load default config file`
2. `Could not parse font file`

**Attempted Fixes (All Failed):**
- Different font paths
- `FONTCONFIG_PATH` environment variable
- Custom `fonts.conf` file
- Simplified font registration without weight/style
- Multiple font family names

**Current Status:** Text drawing is commented out. Consider alternatives:
1. Use a different charting library that doesn't rely on `canvas`
2. Pre-render text as images
3. Use SVG-based charting
4. Accept text-less charts

---

## 7. Questions Answered

1. **Stop-loss percentage:** **-35%**
2. **Win threshold:** **≥1.0x** (any profit is a win)
3. **Peak tracking tiers:** **1.5x, 2x, 5x, 10x**
4. **Reset time:** **UTC midnight**
5. **History depth:** **24h, 7d, 4w, 12m** per chain + combined
6. **Per-chain + Combined:** **Both**

---

## 8. Next Steps

1. ✅ Plan documented and parameters confirmed
2. ✅ Chart signal history fix applied (`getTokenEnhancement`, `storeSignalData`)
3. ✅ Slippage logging added
4. ✅ Journey tracking added (`hitPeakAfterDip`, `dippedAfterPeak`)
5. ⏳ Implement `stats` object in `TelegramDBv5`
6. ⏳ Implement `recordSignal()`, `finalizeToken()` methods
7. ⏳ Implement rollover logic (daily/weekly/monthly at UTC midnight)
8. ⏳ Integrate stats collection into `update-prices.js`
9. ⏳ Update `formatSummaryMessage()` to include stats
10. ⏳ Create combined all-chain stats aggregation
11. ⏳ Testing and verification

---

## 9. Implementation Checklist

### Phase 1: Database Schema (telegram-db-v5.js)
- [ ] Add `initStats()` method to create stats object if missing
- [ ] Add `getStats()` method to retrieve current stats
- [ ] Add `recordSignal(signal)` method to increment signal/token counts
- [ ] Add `finalizeToken(token)` method to record peak gains/losses when archived
- [ ] Add rollover methods: `rolloverDaily()`, `rolloverWeekly()`, `rolloverMonthly()`

### Phase 2: Collection Integration (update-prices.js)
- [ ] Call `initStats()` on load
- [ ] Call `finalizeToken()` when archiving a token
- [ ] Call rollover methods at start of run (check if new period)
- [ ] Update `stats.lastUpdated` after processing

### Phase 3: Display Integration (telegram-db-v5.js LeaderboardManager)
- [ ] Update `formatSummaryMessage()` to include stats section
- [ ] Add method to aggregate stats across all chains
- [ ] Format peak tier counts (e.g., "2x 1.5x • 1x 2x")

### Phase 4: Combined Stats
- [ ] Create `/api/get-combined-stats` endpoint
- [ ] Aggregate daily/weekly/monthly across all 4 chains
- [ ] Store combined stats in archive channel or separate file
