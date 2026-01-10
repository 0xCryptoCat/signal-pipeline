/**
 * HTML to Image Card Generator
 * Uses hcti.io API for rendering HTML/CSS to images
 * This supports full CSS including gradients, filters, animations
 */

// HCTI API credentials (free tier: 50 images/month)
const HCTI_USER_ID = process.env.HCTI_USER_ID;
const HCTI_API_KEY = process.env.HCTI_API_KEY;

// Chain SVGs
const CHAIN_SVGS = {
  sol: `<svg viewBox="0 0 397.7 311.7" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="solGrad" x1="360.879" y1="351.455" x2="141.213" y2="-69.294" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient></defs>
    <path fill="url(#solGrad)" d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z"/>
    <path fill="url(#solGrad)" d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z"/>
    <path fill="url(#solGrad)" d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z"/>
  </svg>`,
  eth: `<svg viewBox="0 0 256 417" xmlns="http://www.w3.org/2000/svg">
    <path fill="#627EEA" d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z"/>
    <path fill="#8C8C8C" d="M127.962 0L0 212.32l127.962 75.639V154.158z"/>
    <path fill="#627EEA" d="M127.961 312.187l-1.575 1.92v98.199l1.575 4.6L256 236.587z"/>
    <path fill="#8C8C8C" d="M127.962 416.905v-104.72L0 236.585z"/>
    <path fill="#3C3C3B" d="M127.961 287.958l127.96-75.637-127.96-58.162z"/>
    <path fill="#141414" d="M0 212.32l127.96 75.638v-133.8z"/>
  </svg>`,
  bsc: `<svg viewBox="0 0 126.61 126.61" xmlns="http://www.w3.org/2000/svg">
    <path fill="#F3BA2F" d="M38.73 53.2l24.59-24.58 24.6 24.6 14.3-14.31L63.32 0l-38.9 38.9zM0 63.31L14.3 49l14.31 14.31-14.31 14.3zM38.73 73.41l24.59 24.59 24.6-24.6 14.31 14.29-38.9 38.91-38.91-38.88-.02.02zM97.99 63.31l14.3-14.31 14.32 14.31-14.31 14.3z"/>
    <path fill="#F3BA2F" d="M77.83 63.3L63.32 48.78 52.59 59.51l-1.24 1.23-2.54 2.54 14.51 14.5 14.51-14.47z"/>
  </svg>`,
  base: `<svg viewBox="0 0 111 111" xmlns="http://www.w3.org/2000/svg">
    <path fill="#0052FF" d="M54.921 110.034c30.347 0 54.955-24.608 54.955-54.955S85.268.124 54.921.124C26.025.124 2.208 22.66.125 51.409H71.96v7.171H.125c2.083 28.749 25.9 51.454 54.796 51.454z"/>
  </svg>`,
};

// Chain info
const CHAIN_INFO = {
  sol: { name: 'SOL', gradient: 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)' },
  eth: { name: 'ETH', gradient: 'linear-gradient(135deg, #627EEA 0%, #A8B8EA 100%)' },
  bsc: { name: 'BSC', gradient: 'linear-gradient(135deg, #F3BA2F 0%, #FFE066 100%)' },
  base: { name: 'BASE', gradient: 'linear-gradient(135deg, #0052FF 0%, #66A3FF 100%)' },
};

/**
 * Format market cap
 */
function formatMcap(mcap) {
  if (!mcap || mcap <= 0) return null;
  if (mcap >= 1000000000) return `$${(mcap / 1000000000).toFixed(1)}B`;
  if (mcap >= 1000000) return `$${(mcap / 1000000).toFixed(1)}M`;
  if (mcap >= 1000) return `$${(mcap / 1000).toFixed(1)}K`;
  return `$${Math.round(mcap)}`;
}

/**
 * Format multiplier
 */
function formatMult(mult) {
  if (mult >= 100) return `${Math.round(mult)}x`;
  if (mult >= 10) return `${mult.toFixed(1)}x`;
  return `${mult.toFixed(2)}x`;
}

/**
 * Convert multiplier to percent
 */
function multToPercent(mult) {
  if (mult >= 1) {
    const pct = (mult - 1) * 100;
    if (pct >= 10000) return `+${(pct / 1000).toFixed(0)}K%`;
    if (pct >= 1000) return `+${(pct / 1000).toFixed(1)}K%`;
    return `+${Math.round(pct).toLocaleString()}%`;
  } else {
    const pct = (1 - mult) * 100;
    return `-${Math.round(pct)}%`;
  }
}

/**
 * Get tier from multiplier
 */
function getMultTier(mult) {
  if (mult < 1) return 'loss';
  if (mult < 1.3) return 'weak';
  if (mult < 5) return 'good';
  if (mult < 15) return 'great';
  if (mult < 50) return 'excellent';
  if (mult < 100) return 'epic';
  return 'legendary';
}

/**
 * Generate HTML for the card
 */
function generateCardHtml(data) {
  const {
    symbol,
    chain,
    entryMcap,
    multiplier,
    channelName = 'AI Alpha Signals',
    username = '@aialphasignals',
  } = data;

  const tier = getMultTier(multiplier);
  const chainInfo = CHAIN_INFO[chain] || CHAIN_INFO.sol;
  const chainSvg = CHAIN_SVGS[chain] || CHAIN_SVGS.sol;
  const mcapText = formatMcap(entryMcap);
  const multText = formatMult(multiplier);
  const pctText = multToPercent(multiplier);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      width: 1200px;
      height: 675px;
    }

    .pnl-card {
      width: 1200px;
      height: 675px;
      background: linear-gradient(145deg, #0f0f1a 0%, #1a1a2e 50%, #0f0f1a 100%);
      border-radius: 24px;
      padding: 48px;
      color: white;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .pnl-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background: radial-gradient(ellipse at 80% 20%, rgba(153, 69, 255, 0.15) 0%, transparent 50%),
                  radial-gradient(ellipse at 20% 80%, rgba(34, 197, 94, 0.1) 0%, transparent 50%);
      pointer-events: none;
    }

    .pnl-card::after {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      background-image: 
        linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
      background-size: 40px 40px;
      pointer-events: none;
    }

    .header {
      display: flex;
      flex-direction: column;
      position: relative;
      z-index: 1;
    }

    .channel-name {
      font-size: 28px;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.5);
      margin-bottom: 16px;
    }

    .token-row {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .token-symbol {
      font-size: 72px;
      font-weight: 800;
      background: ${chainInfo.gradient};
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .chain-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      padding: 10px;
    }

    .chain-badge svg {
      width: 28px;
      height: 28px;
    }

    .entry-mc {
      font-size: 28px;
      color: rgba(255, 255, 255, 0.4);
      margin-top: 12px;
    }

    .entry-mc span {
      color: #22C55E;
      font-weight: 600;
    }

    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      position: relative;
      z-index: 1;
    }

    .multiplier-label {
      font-size: 20px;
      color: rgba(255, 255, 255, 0.4);
      text-transform: uppercase;
      letter-spacing: 4px;
      margin-bottom: 8px;
    }

    .multiplier-value {
      font-size: 180px;
      font-weight: 900;
      line-height: 0.9;
    }

    .percent-change {
      font-size: 42px;
      font-weight: 600;
      margin-top: 8px;
    }

    /* Tier colors */
    .mult-tier-loss .multiplier-value {
      background: linear-gradient(135deg, #EF4444 0%, #F87171 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 0 40px rgba(239, 68, 68, 0.4));
    }
    .mult-tier-loss .percent-change { color: #EF4444; }

    .mult-tier-weak .multiplier-value {
      background: linear-gradient(135deg, #F97316 0%, #FB923C 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 0 40px rgba(249, 115, 22, 0.4));
    }
    .mult-tier-weak .percent-change { color: #F97316; }

    .mult-tier-good .multiplier-value {
      background: linear-gradient(135deg, #EAB308 0%, #FACC15 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 0 50px rgba(234, 179, 8, 0.5));
    }
    .mult-tier-good .percent-change { color: #EAB308; }

    .mult-tier-great .multiplier-value {
      background: linear-gradient(135deg, #22C55E 0%, #4ADE80 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 0 60px rgba(34, 197, 94, 0.5));
    }
    .mult-tier-great .percent-change { color: #22C55E; }

    .mult-tier-excellent .multiplier-value {
      background: linear-gradient(135deg, #10B981 0%, #14F195 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 0 70px rgba(20, 241, 149, 0.6));
    }
    .mult-tier-excellent .percent-change { color: #10B981; }

    .mult-tier-epic .multiplier-value {
      background: linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 0 80px rgba(59, 130, 246, 0.7));
    }
    .mult-tier-epic .percent-change { color: #3B82F6; }

    .mult-tier-legendary .multiplier-value {
      background: linear-gradient(135deg, #8B5CF6 0%, #A855F7 50%, #D946EF 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      filter: drop-shadow(0 0 100px rgba(217, 70, 239, 0.8)) 
              drop-shadow(0 0 140px rgba(251, 191, 36, 0.6));
    }
    .mult-tier-legendary .percent-change { 
      color: #A855F7; 
      text-shadow: 0 0 30px rgba(168, 85, 247, 0.6);
    }

    .footer {
      display: flex;
      justify-content: flex-end;
      position: relative;
      z-index: 1;
    }

    .username {
      font-size: 24px;
      color: rgba(255, 255, 255, 0.4);
    }
  </style>
</head>
<body>
  <div class="pnl-card mult-tier-${tier}">
    <div class="header">
      <div class="channel-name">${channelName}</div>
      <div class="token-row">
        <span class="token-symbol">$${symbol}</span>
        <div class="chain-badge">${chainSvg}</div>
      </div>
      ${mcapText ? `<div class="entry-mc">First signal @ <span>${mcapText}</span> MC</div>` : ''}
    </div>
    
    <div class="content">
      <div class="multiplier-label">Peak Multiplier</div>
      <div class="multiplier-value">${multText}</div>
      <div class="percent-change">${pctText}</div>
    </div>
    
    <div class="footer">
      <div class="username">${username}</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generate PnL card using HCTI API
 * Returns PNG buffer
 */
export async function generatePnlCard(data) {
  const html = generateCardHtml(data);
  
  // Use HCTI API to render HTML to image
  const response = await fetch('https://hcti.io/v1/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Basic ${Buffer.from(`${HCTI_USER_ID}:${HCTI_API_KEY}`).toString('base64')}`,
    },
    body: JSON.stringify({
      html,
      css: '',
      google_fonts: 'Inter',
      viewport_width: 1200,
      viewport_height: 675,
      device_scale: 2,  // Retina quality
    }),
  });

  if (!response.ok) {
    throw new Error(`HCTI API error: ${response.status}`);
  }

  const result = await response.json();
  
  // Fetch the image
  const imageResponse = await fetch(result.url);
  const arrayBuffer = await imageResponse.arrayBuffer();
  
  return Buffer.from(arrayBuffer);
}

// Export HTML generator for testing/preview
export { generateCardHtml, formatMcap, formatMult, multToPercent, getMultTier };

export default { generatePnlCard, generateCardHtml };
