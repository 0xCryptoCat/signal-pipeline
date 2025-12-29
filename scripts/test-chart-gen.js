
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import fs from 'fs';
import { loadImage } from 'canvas';

// ============================================================
// CONFIGURATION
// ============================================================

const WIDTH = 1280;
const HEIGHT = 720; // 16:9
const CHART_CALLBACK = (ChartJS) => {
  // Register plugins if needed
  ChartJS.defaults.font.family = 'Arial';
};

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
    icon: 'https://cryptologos.cc/logos/base-base-logo.png?v=029' // Placeholder, might not exist there
  }
};

// ============================================================
// MOCK DATA GENERATOR
// ============================================================

function generateMockData(points = 100) {
  const data = [];
  let price = 1.0;
  const now = Date.now();
  const interval = 15 * 60 * 1000; // 15m
  
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

async function generateChart(chainKey, tokenSymbol, tokenLogoUrl, signalEntries = []) {
  const theme = THEMES[chainKey];
  const dataPoints = generateMockData(100);
  
  const xValues = dataPoints.map(p => p.x);
  const minX = Math.min(...xValues);
  const maxX = Math.max(...xValues);
  
  // If no entries provided, pick a random point as "entry signal" (e.g., 80% through)
  if (signalEntries.length === 0) {
    signalEntries = [80];
  }

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

  const chartJSNodeCanvas = new ChartJSNodeCanvas({ 
    width: WIDTH, 
    height: HEIGHT, 
    backgroundColour: '#1a1a1a', // Fallback
    chartCallback: CHART_CALLBACK
  });

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
      ctx.font = 'bold 120px Arial';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)'; // Very transparent
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
        ctx.font = 'bold 48px Arial';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tokenSymbol, padding + 160, padding + 30);

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

  const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  return buffer;
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log('🎨 Generating test charts...');
  
  if (!fs.existsSync('./output')) {
    fs.mkdirSync('./output');
  }

  const tests = [
    { chain: 'sol', symbol: 'WIF', icon: 'https://assets.coingecko.com/coins/images/33566/standard/dogwifhat.jpg?1702499428', entries: [20, 50, 80] },
    { chain: 'eth', symbol: 'PEPE', icon: 'https://assets.coingecko.com/coins/images/29850/standard/pepe-token.jpeg?1682922725', entries: [80] },
    { chain: 'bsc', symbol: 'CAKE', icon: 'https://assets.coingecko.com/coins/images/12632/standard/pancakeswap-cake-logo_%281%29.png?1629359065', entries: [40, 80] },
    { chain: 'base', symbol: 'BRETT', icon: 'https://assets.coingecko.com/coins/images/35564/standard/brett.png?1709193292', entries: [80] }
  ];

  for (const t of tests) {
    console.log(`   Generating ${t.chain.toUpperCase()} - ${t.symbol}...`);
    const buffer = await generateChart(t.chain, t.symbol, t.icon, t.entries);
    fs.writeFileSync(`./output/chart-${t.chain}-${t.symbol}.png`, buffer);
  }
  
  console.log('✅ Done! Check ./output folder');
}

main().catch(console.error);
