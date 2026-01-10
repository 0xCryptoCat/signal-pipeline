/**
 * SVG-based PnL Card Generator
 * Uses resvg-js to render SVG to PNG (works on Vercel serverless)
 * SVG supports gradients, filters, and most styling we need
 */

import { Resvg } from '@resvg/resvg-js';

// Card dimensions
const WIDTH = 1200;
const HEIGHT = 675;

// Chain colors
const CHAIN_COLORS = {
  sol: { primary: '#9945FF', secondary: '#14F195' },
  eth: { primary: '#627EEA', secondary: '#A8B8EA' },
  bsc: { primary: '#F3BA2F', secondary: '#FFE066' },
  base: { primary: '#0052FF', secondary: '#66A3FF' },
};

// Chain SVG paths
const CHAIN_PATHS = {
  sol: `<g transform="translate(12, 8) scale(0.08)">
    <path fill="url(#chainGrad)" d="M64.6,237.9c2.4-2.4,5.7-3.8,9.2-3.8h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,237.9z"/>
    <path fill="url(#chainGrad)" d="M64.6,3.8C67.1,1.4,70.4,0,73.8,0h317.4c5.8,0,8.7,7,4.6,11.1l-62.7,62.7c-2.4,2.4-5.7,3.8-9.2,3.8H6.5c-5.8,0-8.7-7-4.6-11.1L64.6,3.8z"/>
    <path fill="url(#chainGrad)" d="M333.1,120.1c-2.4-2.4-5.7-3.8-9.2-3.8H6.5c-5.8,0-8.7,7-4.6,11.1l62.7,62.7c2.4,2.4,5.7,3.8,9.2,3.8h317.4c5.8,0,8.7-7,4.6-11.1L333.1,120.1z"/>
  </g>`,
  eth: `<g transform="translate(14, 6) scale(0.07)">
    <path fill="#627EEA" d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z"/>
    <path fill="#A8B8EA" d="M127.962 0L0 212.32l127.962 75.639V154.158z"/>
    <path fill="#627EEA" d="M127.961 312.187l-1.575 1.92v98.199l1.575 4.6L256 236.587z"/>
    <path fill="#A8B8EA" d="M127.962 416.905v-104.72L0 236.585z"/>
  </g>`,
  bsc: `<g transform="translate(10, 10) scale(0.25)">
    <path fill="#F3BA2F" d="M38.73 53.2l24.59-24.58 24.6 24.6 14.3-14.31L63.32 0l-38.9 38.9zM0 63.31L14.3 49l14.31 14.31-14.31 14.3zM38.73 73.41l24.59 24.59 24.6-24.6 14.31 14.29-38.9 38.91-38.91-38.88-.02.02zM97.99 63.31l14.3-14.31 14.32 14.31-14.31 14.3z"/>
    <path fill="#F3BA2F" d="M77.83 63.3L63.32 48.78 52.59 59.51l-1.24 1.23-2.54 2.54 14.51 14.5 14.51-14.47z"/>
  </g>`,
  base: `<g transform="translate(12, 12) scale(0.25)">
    <path fill="#0052FF" d="M54.921 110.034c30.347 0 54.955-24.608 54.955-54.955S85.268.124 54.921.124C26.025.124 2.208 22.66.125 51.409H71.96v7.171H.125c2.083 28.749 25.9 51.454 54.796 51.454z"/>
  </g>`,
};

// Tier colors
const TIER_COLORS = {
  loss: { primary: '#EF4444', secondary: '#F87171', glow: 'rgba(239, 68, 68, 0.4)' },
  weak: { primary: '#F97316', secondary: '#FB923C', glow: 'rgba(249, 115, 22, 0.4)' },
  good: { primary: '#EAB308', secondary: '#FACC15', glow: 'rgba(234, 179, 8, 0.5)' },
  great: { primary: '#22C55E', secondary: '#4ADE80', glow: 'rgba(34, 197, 94, 0.5)' },
  excellent: { primary: '#10B981', secondary: '#14F195', glow: 'rgba(20, 241, 149, 0.6)' },
  epic: { primary: '#3B82F6', secondary: '#60A5FA', glow: 'rgba(59, 130, 246, 0.7)' },
  legendary: { primary: '#A855F7', secondary: '#D946EF', glow: 'rgba(217, 70, 239, 0.8)' },
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
 * Generate SVG for the card
 */
function generateCardSvg(data) {
  const {
    symbol,
    chain,
    entryMcap,
    multiplier,
    channelName = 'AI Alpha Signals',
    username = '@aialphasignals',
  } = data;

  const tier = getMultTier(multiplier);
  const tierColors = TIER_COLORS[tier];
  const chainColors = CHAIN_COLORS[chain] || CHAIN_COLORS.sol;
  const chainPath = CHAIN_PATHS[chain] || CHAIN_PATHS.sol;
  const mcapText = formatMcap(entryMcap);
  const multText = formatMult(multiplier);
  const pctText = multToPercent(multiplier);

  return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background gradient -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#0f0f1a"/>
      <stop offset="50%" style="stop-color:#1a1a2e"/>
      <stop offset="100%" style="stop-color:#0f0f1a"/>
    </linearGradient>
    
    <!-- Chain gradient -->
    <linearGradient id="chainGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${chainColors.primary}"/>
      <stop offset="100%" style="stop-color:${chainColors.secondary}"/>
    </linearGradient>
    
    <!-- Multiplier gradient -->
    <linearGradient id="multGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${tierColors.primary}"/>
      <stop offset="100%" style="stop-color:${tierColors.secondary}"/>
    </linearGradient>
    
    <!-- Glow filter -->
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="20" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    <!-- Strong glow for multiplier -->
    <filter id="multGlow" x="-100%" y="-100%" width="300%" height="300%">
      <feGaussianBlur stdDeviation="40" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>

    <!-- Grid pattern -->
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="${WIDTH}" height="${HEIGHT}" rx="24" fill="url(#bgGrad)"/>
  
  <!-- Grid overlay -->
  <rect width="${WIDTH}" height="${HEIGHT}" rx="24" fill="url(#grid)"/>
  
  <!-- Ambient glow -->
  <ellipse cx="900" cy="150" rx="400" ry="300" fill="rgba(153, 69, 255, 0.08)"/>
  <ellipse cx="300" cy="500" rx="350" ry="250" fill="rgba(34, 197, 94, 0.06)"/>
  
  <!-- Center glow based on tier -->
  <ellipse cx="600" cy="380" rx="300" ry="200" fill="${tierColors.glow}" opacity="0.4"/>

  <!-- Header: Channel name -->
  <text x="48" y="70" fill="rgba(255,255,255,0.5)" font-family="Inter, sans-serif" font-size="28" font-weight="600">${channelName}</text>
  
  <!-- Header: Token symbol -->
  <text x="48" y="140" fill="url(#chainGrad)" font-family="Inter, sans-serif" font-size="72" font-weight="800">$${symbol}</text>
  
  <!-- Chain badge -->
  <g transform="translate(${48 + symbol.length * 45 + 20}, 98)">
    <circle cx="24" cy="24" r="24" fill="rgba(255,255,255,0.1)"/>
    ${chainPath}
  </g>
  
  <!-- Entry MC -->
  ${mcapText ? `<text x="48" y="190" fill="rgba(255,255,255,0.4)" font-family="Inter, sans-serif" font-size="28" font-weight="500">First signal @ <tspan fill="#22C55E" font-weight="600">${mcapText}</tspan> MC</text>` : ''}

  <!-- Multiplier label -->
  <text x="600" y="290" fill="rgba(255,255,255,0.4)" font-family="Inter, sans-serif" font-size="20" font-weight="600" text-anchor="middle" letter-spacing="4">PEAK MULTIPLIER</text>
  
  <!-- Multiplier value (with glow) -->
  <text x="600" y="430" fill="url(#multGrad)" font-family="Inter, sans-serif" font-size="180" font-weight="900" text-anchor="middle" filter="url(#multGlow)">${multText}</text>
  
  <!-- Percent change -->
  <text x="600" y="490" fill="${tierColors.primary}" font-family="Inter, sans-serif" font-size="42" font-weight="600" text-anchor="middle">${pctText}</text>

  <!-- Footer: Username -->
  <text x="${WIDTH - 48}" y="${HEIGHT - 36}" fill="rgba(255,255,255,0.4)" font-family="Inter, sans-serif" font-size="24" font-weight="500" text-anchor="end">${username}</text>
</svg>`;
}

/**
 * Generate PnL card as PNG buffer
 */
export async function generatePnlCard(data) {
  const svg = generateCardSvg(data);
  
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: [], // Will use system fonts
      loadSystemFonts: true,
      defaultFontFamily: 'Inter',
    },
    fitTo: {
      mode: 'width',
      value: WIDTH * 2, // 2x for retina
    },
  });
  
  const pngData = resvg.render();
  return pngData.asPng();
}

// Export for testing
export { generateCardSvg, formatMcap, formatMult, multToPercent, getMultTier };

export default { generatePnlCard, generateCardSvg };
