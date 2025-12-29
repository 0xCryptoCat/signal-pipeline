import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { loadImage } from 'canvas';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIGURATION
// ============================================================

const WIDTH = 1280;
const HEIGHT = 720; // 16:9
const CHART_CALLBACK = (ChartJS) => {
  ChartJS.defaults.font.family = "'Roboto', sans-serif";
};

// ============================================================
// SINGLETON INSTANCE & FONT REGISTRATION
// ============================================================

// Create singleton instance to ensure font registration persists
const chartNode = new ChartJSNodeCanvas({ 
  width: WIDTH, 
  height: HEIGHT, 
  backgroundColour: '#1a1a1a',
  chartCallback: CHART_CALLBACK
});

// Register Font (Roboto-Bold)
try {
  const fontName = 'Roboto-Bold.ttf';
  
  // Log environment for debugging
  console.log('Chart Generator Environment:', {
    cwd: process.cwd(),
    dirname: __dirname,
    platform: process.platform
  });

  const pathsToTry = [
    path.join(process.cwd(), 'fonts', fontName),
    path.join(__dirname, '..', 'fonts', fontName),
    path.join(__dirname, 'fonts', fontName),
    path.resolve('./fonts', fontName)
  ];

  let registered = false;
  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      console.log(`Found font at ${p}, registering on chartNode...`);
      
      // Register on the chartNode instance directly
      // This ensures it uses the same canvas module instance as the chart renderer
      chartNode.registerFont(p, { family: 'Roboto', weight: 'bold' });
      chartNode.registerFont(p, { family: 'Roboto', weight: 'normal' });
      chartNode.registerFont(p, { family: 'Roboto' });
      
      // Fallbacks
      chartNode.registerFont(p, { family: 'sans-serif', weight: 'bold' });
      chartNode.registerFont(p, { family: 'sans-serif', weight: 'normal' });
      chartNode.registerFont(p, { family: 'sans-serif' });

      registered = true;
      break;
    }
  }
  
  if (!registered) {
    console.warn(`Font file ${fontName} not found in any checked path: ${pathsToTry.join(', ')}`);
  }
} catch (e) {
  console.warn('Failed to register font:', e.message);
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

function generateMockData(points = 100) {
  const data = [];
  let price = 1.0;
  const now = Date.now();
  const interval = 60 * 1000; // 1m
  
  for (let i = 0; i < points; i++) {
    const change = (Math.random() - 0.48) * 0.05; // Slight upward trend
    price = price * (1 + change);
    data.push({
      x: now - (points - i) * interval,
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
 * @returns {Promise<Buffer>} PNG image buffer
 */
export async function generateChart(chainKey, tokenSymbol, tokenLogoUrl, priceData = null, signalEntries = []) {
  const theme = THEMES[chainKey] || THEMES.sol; // Fallback to SOL theme
  const dataPoints = priceData && priceData.length > 0 ? priceData : generateMockData(100);
  
  // If no entries provided, pick the last point as "entry signal"
  if (signalEntries.length === 0) {
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
      ctx.font = 'bold 150px Roboto, sans-serif'; // Increased size
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; // Slightly more visible
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('@AiAlphaSignals', 0, 0);
      ctx.restore();

      // 3. Header Area (Top Left)
      const padding = 40;
      
      try {
        // Chain Icon
        if (chainLogoImage) {
          ctx.drawImage(chainLogoImage, padding, padding, 60, 60);
        } else {
          // Draw Chain Icon Placeholder (Circle with border)
          ctx.save();
          ctx.beginPath();
          ctx.arc(padding + 30, padding + 30, 30, 0, Math.PI * 2);
          ctx.fillStyle = '#333';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = theme.color;
          ctx.stroke();
          ctx.restore();
        }

        // Token Icon
        if (tokenLogoImage) {
          // Circular clip for token icon
          ctx.save();
          ctx.beginPath();
          ctx.arc(padding + 110, padding + 30, 30, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(tokenLogoImage, padding + 80, padding, 60, 60);
          ctx.restore();
        } else {
          // Token Icon Placeholder
          ctx.save();
          ctx.beginPath();
          ctx.arc(padding + 110, padding + 30, 30, 0, Math.PI * 2);
          ctx.fillStyle = '#444';
          ctx.fill();
          ctx.restore();
        }

        // Text: Symbol
        ctx.font = 'bold 48px Roboto, sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tokenSymbol, padding + 160, padding + 30);
        
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
          top: 120, // Space for header
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

  const buffer = await chartNode.renderToBuffer(configuration);
  return buffer;
}
