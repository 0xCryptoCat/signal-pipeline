# Signal Card Generator

Design exploration for signal card images attached to Telegram messages.

## Design Concept

```
┌──────────────────────────────────────────────┐
│  🟣 SOLANA                        🔵 1.24    │
│                                              │
│  TOKEN NAME                                  │
│  SYMBOL                                      │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │         📈 Price Sparkline             │  │
│  │    ╱╲                                  │  │
│  │   ╱  ╲    ╱╲                          │  │
│  │  ╱    ╲  ╱  ╲  ╱                      │  │
│  │ ╱      ╲╱    ╲╱                       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  MCap: $1.3M     Vol: $45K     5 wallets    │
│  Max Gain: 19x (+1,860%)                     │
│                                              │
└──────────────────────────────────────────────┘
```

## Chain Colors

| Chain | Primary Color | Hex |
|-------|--------------|-----|
| Solana | Purple | `#9945FF` |
| Ethereum | Blue | `#627EEA` |
| BSC | Yellow/Gold | `#F3BA2F` |
| Base | Blue | `#0052FF` |

## Rating Colors (Score-based)

| Score Range | Color | Hex |
|-------------|-------|-----|
| ≥ 1.5 (Excellent) | Blue | `#3B82F6` |
| ≥ 0.5 (Good) | Green | `#22C55E` |
| ≥ -0.5 (Neutral) | Gray | `#9CA3AF` |
| ≥ -1.5 (Weak) | Orange | `#F97316` |
| < -1.5 (Poor) | Red | `#EF4444` |

## Implementation Options

### Option 1: Vercel OG (@vercel/og)
- Uses Satori under the hood
- Generates PNG from React/JSX
- Native to Vercel, fast cold starts
- Limited styling (no full CSS)

### Option 2: HTML Canvas + node-canvas
- More control over rendering
- Heavier dependencies
- Can use any fonts

### Option 3: Pre-made SVG Templates
- Create SVG templates
- Replace placeholders with data
- Convert to PNG with sharp/resvg

### Option 4: QuickChart.io (External)
- Simple API for charts
- No server-side rendering needed
- Example: `https://quickchart.io/chart?c={...}`

## Recommended: Vercel OG + QuickChart Sparkline

1. Use QuickChart.io for the sparkline only
2. Use @vercel/og for the card layout
3. Embed sparkline as image in the card

## Files

- `template.html` - Visual HTML mockup
- `generate.js` - Node script to test generation
- `api/card.js` - Vercel endpoint (future)
