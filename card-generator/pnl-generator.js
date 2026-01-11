/**
 * PnL Card Generator
 * Generates shareable PnL cards as images
 * 
 * Uses Puppeteer for local/server rendering
 * For Vercel Edge, use @vercel/og in the API route directly
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load logo.png as base64 data URL (cached)
let LOGO_DATA_URL = null;
function getLogoDataUrl() {
  if (LOGO_DATA_URL) return LOGO_DATA_URL;
  try {
    const logoPath = path.join(__dirname, 'logo.png');
    const logoBuffer = fs.readFileSync(logoPath);
    LOGO_DATA_URL = `data:image/png;base64,${logoBuffer.toString('base64')}`;
    return LOGO_DATA_URL;
  } catch (err) {
    console.error('Failed to load logo.png:', err.message);
    return null;
  }
}

// Chain SVG icons (inline for portability)
const CHAIN_SVGS = {
  sol: `<svg viewBox="0 0 397.7 311.7" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="solGrad" x1="360.879" y1="351.455" x2="141.213" y2="-69.294" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#00FFA3"/>
        <stop offset="1" stop-color="#DC1FFF"/>
      </linearGradient>
    </defs>
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

/**
 * Format market cap for display
 */
export function formatMcap(mcap) {
  if (!mcap || mcap <= 0) return null;
  if (mcap >= 1000000000) return `$${(mcap / 1000000000).toFixed(1)}B`;
  if (mcap >= 1000000) return `$${(mcap / 1000000).toFixed(1)}M`;
  if (mcap >= 1000) return `$${(mcap / 1000).toFixed(1)}K`;
  return `$${Math.round(mcap)}`;
}

/**
 * Format price for display
 */
export function formatPrice(price) {
  if (!price || price <= 0) return '$0';
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  if (price >= 0.0001) return `$${price.toFixed(6)}`;
  return `$${price.toExponential(2)}`;
}

/**
 * Format multiplier for display
 */
export function formatMult(mult) {
  if (mult >= 100) return `${Math.round(mult)}x`;
  if (mult >= 10) return `${mult.toFixed(1)}x`;
  return `${mult.toFixed(2)}x`;
}

/**
 * Convert multiplier to percent string (just the percent value)
 */
export function multToPercent(mult) {
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
 * Format duration between two timestamps
 */
export function formatDuration(startTime, endTime) {
  const diffMs = endTime - startTime;
  if (diffMs < 0) return '';
  
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

/**
 * Get multiplier tier class for coloring
 * Tiers:
 *   0-1x: loss (red)
 *   1-1.3x: weak (orange)
 *   1.3-5x: good (yellow/gold)
 *   5-15x: great (light green)
 *   15-50x: excellent (intense green)
 *   50-100x: epic (blue)
 *   100x+: legendary (purple neon with gold glow)
 */
export function getMultTier(mult) {
  if (mult < 1) return 'loss';
  if (mult < 1.3) return 'weak';
  if (mult < 5) return 'good';
  if (mult < 15) return 'great';
  if (mult < 50) return 'excellent';
  if (mult < 100) return 'epic';
  return 'legendary';
}

/**
 * Get chain info including SVG
 */
export function getChainInfo(chain) {
  const chains = {
    sol: { 
      name: 'SOL', 
      color: '#9945FF', 
      gradient: 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)',
      svg: CHAIN_SVGS.sol,
    },
    eth: { 
      name: 'ETH', 
      color: '#627EEA', 
      gradient: 'linear-gradient(135deg, #627EEA 0%, #A8B8EA 100%)',
      svg: CHAIN_SVGS.eth,
    },
    bsc: { 
      name: 'BSC', 
      color: '#F3BA2F', 
      gradient: 'linear-gradient(135deg, #F3BA2F 0%, #FFE066 100%)',
      svg: CHAIN_SVGS.bsc,
    },
    base: { 
      name: 'BASE', 
      color: '#0052FF', 
      gradient: 'linear-gradient(135deg, #0052FF 0%, #66A3FF 100%)',
      svg: CHAIN_SVGS.base,
    },
  };
  return chains[chain] || chains.sol;
}

/**
 * Calculate time difference in human readable format
 */
export function formatTimeDiff(fromMs, toMs) {
  const diff = toMs - fromMs;
  const hours = Math.floor(diff / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
}

/**
 * Generate the multiplier tier CSS styles
 */
function getMultTierStyles() {
  return `
    /* Tier 1: 0x - 1x (Loss - Light Red) */
    .mult-tier-loss .multiplier-value {
      background: linear-gradient(135deg, #EF4444 0%, #F87171 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(0 0 30px rgba(239, 68, 68, 0.3));
    }
    .mult-tier-loss .percent-change { color: #EF4444; }

    /* Tier 2: 1x - 1.3x (Weak - Orange) */
    .mult-tier-weak .multiplier-value {
      background: linear-gradient(135deg, #F97316 0%, #FB923C 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(0 0 30px rgba(249, 115, 22, 0.3));
    }
    .mult-tier-weak .percent-change { color: #F97316; }

    /* Tier 3: 1.3x - 5x (Good - Yellow/Gold) */
    .mult-tier-good .multiplier-value {
      background: linear-gradient(135deg, #EAB308 0%, #FACC15 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(0 0 40px rgba(234, 179, 8, 0.4));
    }
    .mult-tier-good .percent-change { color: #EAB308; }

    /* Tier 4: 5x - 15x (Great - Light Green) */
    .mult-tier-great .multiplier-value {
      background: linear-gradient(135deg, #22C55E 0%, #4ADE80 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(0 0 50px rgba(34, 197, 94, 0.4));
    }
    .mult-tier-great .percent-change { color: #22C55E; }

    /* Tier 5: 15x - 50x (Excellent - Intense Green) */
    .mult-tier-excellent .multiplier-value {
      background: linear-gradient(135deg, #10B981 0%, #14F195 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(0 0 60px rgba(20, 241, 149, 0.5));
    }
    .mult-tier-excellent .percent-change { color: #10B981; }

    /* Tier 6: 50x - 100x (Epic - Blue) */
    .mult-tier-epic .multiplier-value {
      background: linear-gradient(135deg, #3B82F6 0%, #60A5FA 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(0 0 70px rgba(59, 130, 246, 0.6));
    }
    .mult-tier-epic .percent-change { color: #3B82F6; }

    /* Tier 7: 100x+ (Legendary - Purple Neon with Gold Glow) */
    .mult-tier-legendary .multiplier-value {
      background: linear-gradient(135deg, #8B5CF6 0%, #A855F7 50%, #D946EF 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      filter: drop-shadow(0 0 80px rgba(217, 70, 239, 0.7)) 
              drop-shadow(0 0 120px rgba(251, 191, 36, 0.5));
    }
    .mult-tier-legendary .percent-change { 
      color: #A855F7; 
      text-shadow: 0 0 20px rgba(168, 85, 247, 0.5);
    }
  `;
}

/**
 * Generate HTML for PnL card
 */
export function generatePnlCardHtml(data) {
  const {
    symbol = 'UNKNOWN',
    chain = 'sol',
    entryMcap = 0,
    multiplier = 1,
    channelName = 'AI Alpha Signals',
    username = '@aialphasignals',
    logoUrl = null,
    firstSeen = null,
    peakTime = null,
  } = data;

  const chainInfo = getChainInfo(chain);
  const multTier = getMultTier(multiplier);
  
  // Calculate time to peak
  const timeToPeak = (firstSeen && peakTime) ? formatDuration(firstSeen, peakTime) : null;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Noto+Sans+SC:wght@400;600;700;900&family=Noto+Sans+JP:wght@400;600;700;900&family=Noto+Sans+KR:wght@400;600;700;900&display=swap');
    
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: 'Inter', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', -apple-system, BlinkMacSystemFont, sans-serif;
      background: transparent;
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
      justify-content: space-between;
      align-items: flex-start;
      position: relative;
      z-index: 1;
    }

    .channel-name {
      font-size: 36px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: -0.5px;
    }

    .token-info {
      text-align: right;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    .token-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .token-symbol {
      font-size: 42px;
      font-weight: 800;
      font-family: 'Inter', 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', sans-serif;
      background: ${chainInfo.gradient};
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .chain-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      padding: 8px;
    }

    .chain-badge svg {
      width: 24px;
      height: 24px;
    }

    .entry-mc {
      font-size: 24px;
      color: rgba(255, 255, 255, 0.6);
    }

    .entry-mc span {
      color: #22C55E;
      font-weight: 600;
    }

    .content {
      flex: 1;
      display: flex;
      justify-content: flex-end;
      align-items: center;
      position: relative;
      z-index: 1;
    }

    .logo-container {
      position: absolute;
      bottom: -20%;
      left: -5%;
      z-index: 2;
    }

    .logo-container img {
      width: 500px;
      height: 500px;
      object-fit: contain;
    }

    .multiplier-section {
      text-align: right;
    }

    .multiplier-label {
      font-size: 24px;
      color: rgba(255, 255, 255, 0.5);
      text-transform: uppercase;
      letter-spacing: 3px;
      margin-bottom: 12px;
    }

    .multiplier-value {
      font-size: 200px;
      font-weight: 900;
      line-height: 0.9;
    }

    .percent-change {
      font-size: 36px;
      font-weight: 600;
      margin-top: 12px;
    }
    
    .percent-change .gray-text {
      color: rgba(255, 255, 255, 0.5);
      font-weight: 400;
    }

    .footer {
      display: flex;
      justify-content: flex-end;
      align-items: flex-end;
      position: relative;
      z-index: 1;
      margin-top: auto;
    }

    .username {
      font-size: 24px;
      color: rgba(255, 255, 255, 0.5);
    }

    ${getMultTierStyles()}
  </style>
</head>
<body>
  <div class="pnl-card mult-tier-${multTier}">
    <div class="header">
      <div class="channel-name">${channelName}</div>
      <div class="token-info">
        <div class="token-row">
          <span class="token-symbol">$${symbol}</span>
          <div class="chain-badge">
            ${chainInfo.svg}
          </div>
        </div>
        <div class="entry-mc">First signal @ <span>${formatMcap(entryMcap) || 'Unknown'}</span> MC</div>
      </div>
    </div>
    
    <div class="content">
      <div class="logo-container">
        <img src="${getLogoDataUrl()}" alt="Logo" />
      </div>
      
      <div class="multiplier-section">
        <div class="multiplier-label">Peak Multiplier</div>
        <div class="multiplier-value">${formatMult(multiplier)}</div>
        <div class="percent-change"><span class="gray-text">${multiplier >= 1 ? 'Gained' : 'Lost'}</span> ${multToPercent(multiplier)}${timeToPeak ? ` <span class="gray-text">in ${timeToPeak}</span>` : ''}</div>
      </div>
    </div>
    
    <div class="footer">
      <div class="username">${username}</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Render HTML to PNG using Puppeteer (for local/server use)
 * Note: For Vercel Edge, use @vercel/og directly in the API route
 */
export async function renderCardToImage(html) {
  // Dynamic import to avoid issues when puppeteer isn't installed
  const puppeteer = await import('puppeteer');
  
  const browser = await puppeteer.default.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 675 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  const screenshot = await page.screenshot({
    type: 'png',
    omitBackground: true,
  });
  
  await browser.close();
  
  return screenshot;
}

export default {
  generatePnlCardHtml,
  renderCardToImage,
  formatMcap,
  formatPrice,
  formatMult,
  multToPercent,
  getChainInfo,
  getMultTier,
  formatTimeDiff,
  CHAIN_SVGS,
};
