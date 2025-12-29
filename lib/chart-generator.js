import { Chart, registerables } from 'chart.js';
import { createCanvas, registerFont, loadImage } from 'canvas';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Register Chart.js components
Chart.register(...registerables);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIGURATION
// ============================================================

const WIDTH = 1400;
const HEIGHT = 600; // 2:1 Aspect Ratio (Wider, less tall)

// Configure Global Defaults
// Note: Font family must be set AFTER registerFont is called
Chart.defaults.color = '#FFFFFF';

// ============================================================
// FONT REGISTRATION
// ============================================================

let isFontRegistered = false;

function findFontFile(startPath, fileName) {
  if (!fs.existsSync(startPath)) return null;
  
  const files = fs.readdirSync(startPath);
  for (const file of files) {
    const fullPath = path.join(startPath, file);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      // Don't go too deep or into node_modules
      if (file !== 'node_modules' && file !== '.git') {
        const found = findFontFile(fullPath, fileName);
        if (found) return found;
      }
    } else if (file === fileName) {
      return fullPath;
    }
  }
  return null;
}

function registerCustomFonts() {
  if (isFontRegistered) return;

  try {
    const fontName = 'Roboto-Bold.ttf';
    
    // 1. Try standard paths first
    const possiblePaths = [
      path.join(process.cwd(), 'fonts', fontName),
      path.join(__dirname, 'fonts', fontName),
      path.resolve('./fonts', fontName)
    ];

    let fontPath = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        fontPath = p;
        break;
      }
    }

    // 2. If not found, try recursive search from CWD
    if (!fontPath) {
      console.log('[ChartGen] Font not found in standard paths, searching recursively...');
      fontPath = findFontFile(process.cwd(), fontName);
    }

    if (fontPath) {
      // FIX: Set FONTCONFIG_PATH for Vercel/Lambda to fix "Cannot load default config file"
      // We point it to the directory containing our custom fonts.conf and font file
      // Only apply this on Vercel/Lambda where the path matches the config
      if (!process.env.FONTCONFIG_PATH && (process.env.VERCEL || fontPath.startsWith('/var/task'))) {
        const fontsDir = path.dirname(fontPath);
        process.env.FONTCONFIG_PATH = fontsDir;
        console.log(`[ChartGen] Set FONTCONFIG_PATH to: ${fontsDir}`);
      }

      console.log(`[ChartGen] Registering font from: ${fontPath}`);
      // SIMPLIFIED REGISTRATION:
      // Register as a unique family name 'Alphalert' with NO weight/style options.
      // This forces it to be the default font for this family, bypassing weight matching issues.
      registerFont(fontPath, { family: 'Alphalert' });
      isFontRegistered = true;
      
      // Set Chart.js default font
      Chart.defaults.font.family = '"Alphalert", Arial, sans-serif';
    } else {
      console.error(`[ChartGen] ❌ Font file ${fontName} NOT FOUND anywhere in ${process.cwd()}`);
      // List root contents for debug
      try {
        console.log('[ChartGen] Root contents:', fs.readdirSync(process.cwd()));
      } catch (e) {}
    }
  } catch (e) {
    console.warn('[ChartGen] Failed to register font:', e.message);
  }
}

const THEMES = {
  sol: {
    color: '#9945FF', // Purple
    bgGradient: ['#1a1a1a', '#0f0518'], // Dark gray to dark purple tint
    name: 'Solana',
    icon: 'https://cryptologos.cc/logos/solana-sol-logo.png?v=029'
  },
  eth: {
    color: '#C0C0C0', // Silver
    bgGradient: ['#1a1a1a', '#101010'],
    name: 'Ethereum',
    icon: 'https://cryptologos.cc/logos/ethereum-eth-logo.png?v=029'
  },
  bsc: {
    color: '#F3BA2F', // Yellow
    bgGradient: ['#1a1a1a', '#181200'],
    name: 'BSC',
    icon: 'https://cryptologos.cc/logos/bnb-bnb-logo.png?v=029'
  },
  base: {
    color: '#0052FF', // Blue
    bgGradient: ['#1a1a1a', '#00081a'],
    name: 'Base',
    icon: 'https://cryptologos.cc/logos/base-base-logo.png?v=029'
  }
};

// ============================================================
// MOCK DATA GENERATOR (Fallback)
// ============================================================

function generateMockData(startTime, endTime, points = 150) {
  const data = [];
  let price = 1.0;
  const totalDuration = endTime - startTime;
  const interval = totalDuration / points;
  
  for (let i = 0; i < points; i++) {
    const time = startTime + (i * interval);
    // Random walk
    const change = (Math.random() - 0.48) * 0.05; 
    price = price * (1 + change);
    data.push({
      x: time,
      y: price
    });
  }
  return data;
}

// ============================================================
// CHART GENERATOR
// ============================================================

/**
 * Generates a signal chart image buffer
 * @param {string} chainKey - 'sol', 'eth', 'bsc', 'base'
 * @param {string} tokenSymbol - e.g. 'WIF'
 * @param {string} tokenLogoUrl - URL to token image
 * @param {Array<{x: number, y: number}>} priceData - Array of price points (timestamps and values)
 * @param {Array<number>} signalEntries - Indices of entry points in the data array
 * @param {Array<number>} signalTimestamps - Unix timestamps of signals (overrides signalEntries if provided)
 * @returns {Promise<Buffer>} PNG image buffer
 */
export async function generateChart(chainKey, tokenSymbol, tokenLogoUrl, priceData = null, signalEntries = [], signalTimestamps = []) {
  // Ensure fonts are registered before generating
  registerCustomFonts();
  
  console.log(`[ChartGen] Generating for ${tokenSymbol}, timestamps:`, signalTimestamps);
  
  const theme = THEMES[chainKey] || THEMES.sol; // Fallback to SOL theme
  
  let dataPoints = priceData;
  
  // 1. Generate Mock Data if needed
  if (!dataPoints || dataPoints.length === 0) {
    const now = Date.now();
    let startTime = now - (24 * 60 * 60 * 1000); // Default 24h
    
    if (signalTimestamps.length > 0) {
      const minTime = Math.min(...signalTimestamps);
      // Start 20% before the first signal to give context
      const duration = now - minTime;
      // If duration is very small (e.g. first signal just now), default to 1h
      const effectiveDuration = Math.max(duration, 60 * 60 * 1000);
      
      startTime = minTime - (effectiveDuration * 0.2);
      
      // Ensure we don't go back too far (e.g. < 7 days) if not needed, but at least 1h
      if (now - startTime < 60 * 60 * 1000) {
        startTime = now - (60 * 60 * 1000);
      }
    }
    
    // Generate points up to NOW (so we see post-signal action if signal was in past)
    dataPoints = generateMockData(startTime, now, 200);
  }
  
  // 2. Map Timestamps to Indices
  if (signalTimestamps.length > 0) {
    signalEntries = signalTimestamps.map(ts => {
      // Find closest point
      let closestIdx = 0;
      let minDiff = Infinity;
      dataPoints.forEach((p, i) => {
        const diff = Math.abs(p.x - ts);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = i;
        }
      });
      return closestIdx;
    });
  } else if (signalEntries.length === 0) {
    // Default to last point if no signals specified
    signalEntries = [dataPoints.length - 1];
  }

  const xValues = dataPoints.map(p => p.x);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);

  // PRE-LOAD IMAGES (Must be done before chart rendering)
  let chainLogoImage = null;
  let tokenLogoImage = null;

  try {
    if (theme.icon) {
      chainLogoImage = await loadImage(theme.icon).catch(() => null);
    }
    if (tokenLogoUrl) {
      tokenLogoImage = await loadImage(tokenLogoUrl).catch(() => null);
    }
  } catch (e) {
    console.error('Error loading images:', e);
  }

  // Use the singleton instance
  // const chartJSNodeCanvas = new ChartJSNodeCanvas({ ... }); // REMOVED

  // Create Canvas directly
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Custom Plugin for Background & Header
  const customPlugin = {
    id: 'custom_design',
    beforeDraw: (chart) => {
      const ctx = chart.ctx;
      const { width, height } = chart;

      // 1. Gradient Background
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, theme.bgGradient[0]);
      gradient.addColorStop(1, theme.bgGradient[1]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // 2. Watermark (Centered, Large, Transparent)
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate(-Math.PI / 12); // Slight tilt
      // IMPORTANT: Font must be registered before use. Use exact family name.
      // We use 'Alphalert' which maps to Roboto-Bold.ttf. No 'bold' keyword needed as the font is already bold.
      ctx.font = '120px "Alphalert", Arial, sans-serif'; 
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('@AiAlphaSignals', 0, 0);
      ctx.restore();

      // 3. Header Area (Top Left)
      const padding = 30;
      const iconSize = 120; // Doubled from 60
      const iconRadius = iconSize / 2;
      
      try {
        // Chain Icon
        if (chainLogoImage) {
          ctx.drawImage(chainLogoImage, padding, padding, iconSize, iconSize);
        } else {
          // Draw Chain Icon Placeholder (Circle with border)
          ctx.save();
          ctx.beginPath();
          ctx.arc(padding + iconRadius, padding + iconRadius, iconRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#333';
          ctx.fill();
          ctx.lineWidth = 4;
          ctx.strokeStyle = theme.color;
          ctx.stroke();
          ctx.restore();
        }

        // Token Icon (positioned after chain icon with gap)
        const tokenIconX = padding + iconSize + 20; // Gap of 20px
        if (tokenLogoImage) {
          // Circular clip for token icon
          ctx.save();
          ctx.beginPath();
          ctx.arc(tokenIconX + iconRadius, padding + iconRadius, iconRadius, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(tokenLogoImage, tokenIconX, padding, iconSize, iconSize);
          ctx.restore();
        } else {
          // Token Icon Placeholder
          ctx.save();
          ctx.beginPath();
          ctx.arc(tokenIconX + iconRadius, padding + iconRadius, iconRadius, 0, Math.PI * 2);
          ctx.fillStyle = '#444';
          ctx.fill();
          ctx.restore();
        }

        // Text: Symbol (positioned after token icon)
        const textX = tokenIconX + iconSize + 20;
        ctx.font = '64px "Alphalert", Arial, sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tokenSymbol, textX, padding + iconRadius);
        
        // Removed Chain Name Text

      } catch (err) {
        console.error('Error drawing header:', err);
      }
    },
    afterDraw: (chart) => {
      const ctx = chart.ctx;
      const meta = chart.getDatasetMeta(0);
      
      // Draw Entry Markers for all signals
      signalEntries.forEach((entryIndex, i) => {
        const point = meta.data[entryIndex];
        
        if (point) {
          const x = point.x;
          const y = point.y;
          const isLatest = i === signalEntries.length - 1;

          // Glow effect (stronger for latest)
          ctx.save();
          ctx.shadowColor = theme.color;
          ctx.shadowBlur = isLatest ? 30 : 15;
          ctx.beginPath();
          ctx.arc(x, y, isLatest ? 8 : 6, 0, Math.PI * 2);
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
          ctx.restore();

          // Ring
          ctx.beginPath();
          ctx.arc(x, y, isLatest ? 15 : 10, 0, Math.PI * 2);
          ctx.lineWidth = isLatest ? 3 : 2;
          ctx.strokeStyle = theme.color;
          ctx.stroke();
        }
      });
    }
  };

  const configuration = {
    type: 'line',
    data: {
      datasets: [{
        data: dataPoints,
        borderColor: theme.color,
        borderWidth: 4,
        pointRadius: 0, // Hide normal points
        tension: 0.4, // Smooth curve
        fill: true,
        backgroundColor: (context) => {
          const ctx = context.chart.ctx;
          const gradient = ctx.createLinearGradient(0, 0, 0, HEIGHT);
          gradient.addColorStop(0, theme.color + '66'); // 40% opacity
          gradient.addColorStop(1, theme.color + '00'); // 0% opacity
          return gradient;
        }
      }]
    },
    options: {
      layout: {
        padding: {
          top: 160, // Increased for larger icons
          bottom: 20,
          left: 0,
          right: 0
        }
      },
      plugins: {
        legend: { display: false },
        custom_design: true // Enable our plugin
      },
      scales: {
        x: {
          type: 'linear', // Using linear for timestamp to simplify mock
          display: false, // Hide X axis
          offset: false,
          min: minX,
          max: maxX,
          grid: {
            display: false,
            drawBorder: false
          },
          ticks: {
            display: false
          }
        },
        y: {
          display: false, // Hide Y axis (prices)
          offset: false,
          grid: {
            display: false, // Hide grid lines
            drawBorder: false
          },
          ticks: {
            display: false
          }
        }
      }
    },
    plugins: [customPlugin]
  };

  // Render Chart directly
  const chart = new Chart(ctx, configuration);
  
  // Convert to Buffer
  const buffer = canvas.toBuffer('image/png');
  
  // Cleanup
  chart.destroy();
  
  return buffer;
}
