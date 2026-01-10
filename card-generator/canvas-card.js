/**
 * Canvas-based PnL Card Generator
 * Works on Vercel serverless (no Puppeteer needed)
 */

import { createCanvas, registerFont } from 'canvas';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Card dimensions (16:9)
const WIDTH = 1200;
const HEIGHT = 675;

// Colors
const COLORS = {
  bg: '#0a0a0f',
  bgGradient1: '#0a0a0f',
  bgGradient2: '#1a1a2e',
  text: '#ffffff',
  textMuted: 'rgba(255, 255, 255, 0.5)',
  textDim: 'rgba(255, 255, 255, 0.3)',
};

// Tier colors
const TIER_COLORS = {
  loss: { main: '#ef4444', glow: '#ef4444' },
  weak: { main: '#f97316', glow: '#f97316' },
  good: { main: '#eab308', glow: '#eab308' },
  great: { main: '#22c55e', glow: '#22c55e' },
  excellent: { main: '#10b981', glow: '#10b981' },
  epic: { main: '#3b82f6', glow: '#3b82f6' },
  legendary: { main: '#a855f7', glow: '#fbbf24' },
};

// Chain info
const CHAIN_INFO = {
  sol: { name: 'SOL', color: '#9945FF' },
  eth: { name: 'ETH', color: '#627EEA' },
  bsc: { name: 'BSC', color: '#F3BA2F' },
  base: { name: 'BASE', color: '#0052FF' },
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
 * Draw rounded rectangle
 */
function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Generate PnL card as PNG buffer
 */
export async function generatePnlCard(data) {
  const {
    symbol,
    chain,
    entryMcap,
    multiplier,
    channelName = 'AI Alpha Signals',
    username = '@aialphasignals',
  } = data;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const tier = getMultTier(multiplier);
  const tierColors = TIER_COLORS[tier];
  const chainInfo = CHAIN_INFO[chain] || CHAIN_INFO.sol;

  // Background gradient
  const bgGrad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bgGrad.addColorStop(0, COLORS.bgGradient1);
  bgGrad.addColorStop(1, COLORS.bgGradient2);
  ctx.fillStyle = bgGrad;
  roundRect(ctx, 0, 0, WIDTH, HEIGHT, 24);
  ctx.fill();

  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
  ctx.lineWidth = 1;
  for (let x = 0; x < WIDTH; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < HEIGHT; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }

  // Glow effect behind multiplier
  const glowGrad = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2 + 40, 0, WIDTH / 2, HEIGHT / 2 + 40, 400);
  glowGrad.addColorStop(0, `${tierColors.glow}40`);
  glowGrad.addColorStop(0.5, `${tierColors.glow}10`);
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Header - Channel name
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '600 24px sans-serif';
  ctx.fillText(channelName, 48, 60);

  // Token symbol
  ctx.fillStyle = COLORS.text;
  ctx.font = '800 72px sans-serif';
  ctx.fillText(`$${symbol}`, 48, 140);

  // Chain badge
  const symbolWidth = ctx.measureText(`$${symbol}`).width;
  ctx.fillStyle = chainInfo.color;
  roundRect(ctx, 48 + symbolWidth + 20, 95, 100, 50, 25);
  ctx.fill();
  
  ctx.fillStyle = tier === 'bsc' ? '#000' : '#fff';
  ctx.font = '600 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(chainInfo.name, 48 + symbolWidth + 70, 128);
  ctx.textAlign = 'left';

  // Entry MC
  const mcapText = formatMcap(entryMcap);
  if (mcapText) {
    ctx.fillStyle = COLORS.textDim;
    ctx.font = '500 28px sans-serif';
    ctx.fillText(`First signal @ ${mcapText} MC`, 48, 190);
  }

  // Multiplier - center
  const multText = formatMult(multiplier);
  ctx.fillStyle = tierColors.main;
  ctx.font = '900 200px sans-serif';
  ctx.textAlign = 'center';
  
  // Add shadow/glow
  ctx.shadowColor = tierColors.glow;
  ctx.shadowBlur = 60;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  
  ctx.fillText(multText, WIDTH / 2, HEIGHT / 2 + 60);
  
  // Reset shadow
  ctx.shadowBlur = 0;

  // Percent change
  const pctText = multToPercent(multiplier);
  ctx.fillStyle = tierColors.main;
  ctx.font = '600 48px sans-serif';
  ctx.fillText(pctText, WIDTH / 2, HEIGHT / 2 + 130);
  
  ctx.textAlign = 'left';

  // Footer - username
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '500 24px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(username, WIDTH - 48, HEIGHT - 36);
  ctx.textAlign = 'left';

  // Border glow
  ctx.strokeStyle = `${tierColors.main}30`;
  ctx.lineWidth = 2;
  roundRect(ctx, 1, 1, WIDTH - 2, HEIGHT - 2, 24);
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

export default { generatePnlCard, formatMcap, formatMult, multToPercent, getMultTier };
