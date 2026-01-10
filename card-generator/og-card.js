/**
 * OG Card Generator using @vercel/og (Satori-based)
 * Renders JSX to PNG - works on Vercel Edge/Serverless
 */

import { ImageResponse } from '@vercel/og';

// Card dimensions (16:9)
const WIDTH = 1200;
const HEIGHT = 675;

// Tier colors
const TIER_COLORS = {
  loss: { main: '#ef4444', glow: 'rgba(239, 68, 68, 0.3)' },
  weak: { main: '#f97316', glow: 'rgba(249, 115, 22, 0.3)' },
  good: { main: '#eab308', glow: 'rgba(234, 179, 8, 0.3)' },
  great: { main: '#22c55e', glow: 'rgba(34, 197, 94, 0.3)' },
  excellent: { main: '#10b981', glow: 'rgba(16, 185, 129, 0.3)' },
  epic: { main: '#3b82f6', glow: 'rgba(59, 130, 246, 0.3)' },
  legendary: { main: '#a855f7', glow: 'rgba(168, 85, 247, 0.4)' },
};

// Chain info
const CHAIN_INFO = {
  sol: { name: 'SOL', color: '#9945FF', textColor: '#fff' },
  eth: { name: 'ETH', color: '#627EEA', textColor: '#fff' },
  bsc: { name: 'BSC', color: '#F3BA2F', textColor: '#000' },
  base: { name: 'BASE', color: '#0052FF', textColor: '#fff' },
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
 * Generate PnL card using @vercel/og
 * Returns PNG buffer
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

  const tier = getMultTier(multiplier);
  const tierColors = TIER_COLORS[tier];
  const chainInfo = CHAIN_INFO[chain] || CHAIN_INFO.sol;
  const mcapText = formatMcap(entryMcap);
  const multText = formatMult(multiplier);
  const pctText = multToPercent(multiplier);

  // Create the image using JSX-like syntax
  const response = new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%)',
          padding: '48px',
          fontFamily: 'Inter, sans-serif',
          position: 'relative',
        },
        children: [
          // Grid pattern overlay
          {
            type: 'div',
            props: {
              style: {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
                backgroundSize: '40px 40px',
              },
            },
          },
          // Glow effect
          {
            type: 'div',
            props: {
              style: {
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '600px',
                height: '400px',
                background: `radial-gradient(circle, ${tierColors.glow} 0%, transparent 70%)`,
                borderRadius: '50%',
              },
            },
          },
          // Header
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
              },
              children: [
                // Channel name
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '24px',
                      fontWeight: 600,
                      color: 'rgba(255, 255, 255, 0.5)',
                      marginBottom: '16px',
                    },
                    children: channelName,
                  },
                },
                // Token row
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: '20px',
                    },
                    children: [
                      // Token symbol
                      {
                        type: 'div',
                        props: {
                          style: {
                            fontSize: '72px',
                            fontWeight: 800,
                            color: '#ffffff',
                          },
                          children: `$${symbol}`,
                        },
                      },
                      // Chain badge
                      {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: chainInfo.color,
                            borderRadius: '25px',
                            padding: '8px 24px',
                            fontSize: '24px',
                            fontWeight: 600,
                            color: chainInfo.textColor,
                          },
                          children: chainInfo.name,
                        },
                      },
                    ],
                  },
                },
                // Entry MC
                mcapText ? {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '28px',
                      fontWeight: 500,
                      color: 'rgba(255, 255, 255, 0.3)',
                      marginTop: '12px',
                    },
                    children: `First signal @ ${mcapText} MC`,
                  },
                } : null,
              ].filter(Boolean),
            },
          },
          // Content - Multiplier section
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 1,
              },
              children: [
                // Multiplier value
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '180px',
                      fontWeight: 900,
                      color: tierColors.main,
                      lineHeight: 1,
                      textShadow: `0 0 80px ${tierColors.glow}`,
                    },
                    children: multText,
                  },
                },
                // Percent change
                {
                  type: 'div',
                  props: {
                    style: {
                      fontSize: '48px',
                      fontWeight: 600,
                      color: tierColors.main,
                      marginTop: '8px',
                    },
                    children: pctText,
                  },
                },
              ],
            },
          },
          // Footer
          {
            type: 'div',
            props: {
              style: {
                display: 'flex',
                justifyContent: 'flex-end',
              },
              children: {
                type: 'div',
                props: {
                  style: {
                    fontSize: '24px',
                    fontWeight: 500,
                    color: 'rgba(255, 255, 255, 0.5)',
                  },
                  children: username,
                },
              },
            },
          },
        ],
      },
    },
    {
      width: WIDTH,
      height: HEIGHT,
    }
  );

  // Convert to buffer
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export default { generatePnlCard, formatMcap, formatMult, multToPercent, getMultTier };
