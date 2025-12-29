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

const WIDTH = 1280;
const HEIGHT = 720; // 16:9

// Configure Global Defaults
Chart.defaults.font.family = "'Roboto', 'Arial', sans-serif";
Chart.defaults.color = '#FFFFFF';

// ============================================================
// FONT REGISTRATION
// ============================================================

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
      console.log(`Found font at ${p}, registering globally...`);
      
      // Register with multiple aliases and weights to be safe
      registerFont(p, { family: 'Roboto', weight: 'bold' });
      registerFont(p, { family: 'Roboto', weight: 'normal' }); // Fallback for normal weight
      registerFont(p, { family: 'Roboto' });
      
      // Register as 'sans-serif' fallback
      registerFont(p, { family: 'sans-serif', weight: 'bold' });
      registerFont(p, { family: 'sans-serif', weight: 'normal' });
      
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
  const theme = THEMES[chainKey] || THEMES.sol; // Fallback to SOL theme
  
  let dataPoints = priceData;
  
  // 1. Generate Mock Data if needed
  if (!dataPoints || dataPoints.length === 0) {
    const now = Date.now();
    let startTime = now - (24 * 60 * 60 * 1000); // Default 24h
    
    if (signalTimestamps.length > 0) {
      const minTime = Math.min(...signalTimestamps);
      // Start 10% before the first signal
      const duration = now - minTime;
      startTime = minTime - (duration * 0.1);
      
      // Ensure at least 1h history
      if (now - startTime < 60 * 60 * 1000) {
        startTime = now - (60 * 60 * 1000);
      }
    }
    
    dataPoints = generateMockData(startTime, now, 150);
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

  // Render Chart directly
  const chart = new Chart(ctx, configuration);
  
  // Convert to Buffer
  const buffer = canvas.toBuffer('image/png');
  
  // Cleanup
  chart.destroy();
  
  return buffer;
}
