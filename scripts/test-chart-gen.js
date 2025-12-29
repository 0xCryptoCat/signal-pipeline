
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

async function generateChart(chainKey, tokenSymbol, tokenIconUrl) {
  const theme = THEMES[chainKey];
  const dataPoints = generateMockData(100);
  
  // Pick a random point as "entry signal" (e.g., 80% through)
  const entryIndex = 80;
  const entryPoint = dataPoints[entryIndex];

  const chartJSNodeCanvas = new ChartJSNodeCanvas({ 
    width: WIDTH, 
    height: HEIGHT, 
    backgroundColour: '#1a1a1a', // Fallback
    chartCallback: CHART_CALLBACK
  });

  // Custom Plugin for Background & Header
  const customPlugin = {
    id: 'custom_design',
    beforeDraw: async (chart) => {
      const ctx = chart.ctx;
      const { width, height } = chart;

      // 1. Gradient Background
      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, theme.bgGradient[0]);
      gradient.addColorStop(1, theme.bgGradient[1]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // 2. Header Area (Top Left)
      const headerHeight = 100;
      const padding = 40;
      
      // Load Icons (Mocking loading for now, in real app use proper caching/loading)
      // For this test script, we'll try to load from URL, if fail draw circle
      
      try {
        // Chain Icon
        // const chainIcon = await loadImage(theme.icon);
        // ctx.drawImage(chainIcon, padding, padding, 60, 60);
        
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

        // Token Icon Placeholder
        ctx.save();
        ctx.beginPath();
        ctx.arc(padding + 110, padding + 30, 30, 0, Math.PI * 2);
        ctx.fillStyle = '#444';
        ctx.fill();
        ctx.restore();

        // Text: Symbol
        ctx.font = 'bold 48px Arial';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(tokenSymbol, padding + 160, padding + 30);
        
        // Text: Chain Name (Small below)
        ctx.font = 'bold 20px Arial';
        ctx.fillStyle = theme.color;
        ctx.fillText(theme.name.toUpperCase(), padding, padding + 80);

      } catch (err) {
        console.error('Error drawing header:', err);
      }
    },
    afterDraw: (chart) => {
      const ctx = chart.ctx;
      
      // Draw Entry Marker
      const meta = chart.getDatasetMeta(0);
      const point = meta.data[entryIndex];
      
      if (point) {
        const x = point.x;
        const y = point.y;

        // Glow effect
        ctx.save();
        ctx.shadowColor = theme.color;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.restore();

        // Ring
        ctx.beginPath();
        ctx.arc(x, y, 15, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = theme.color;
        ctx.stroke();
        
        // Label "ENTRY"
        ctx.font = 'bold 16px Arial';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.fillText('ENTRY', x, y - 25);
      }
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
          left: 20,
          right: 20
        }
      },
      plugins: {
        legend: { display: false },
        custom_design: true // Enable our plugin
      },
      scales: {
        x: {
          type: 'linear', // Using linear for timestamp to simplify mock
          display: false // Hide X axis
        },
        y: {
          display: true,
          position: 'right',
          grid: {
            color: '#333333',
            drawBorder: false
          },
          ticks: {
            color: '#888888',
            font: { size: 14 },
            callback: (val) => '$' + val.toFixed(4)
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
    { chain: 'sol', symbol: 'WIF' },
    { chain: 'eth', symbol: 'PEPE' },
    { chain: 'bsc', symbol: 'CAKE' },
    { chain: 'base', symbol: 'BRETT' }
  ];

  for (const t of tests) {
    console.log(`   Generating ${t.chain.toUpperCase()} - ${t.symbol}...`);
    const buffer = await generateChart(t.chain, t.symbol);
    fs.writeFileSync(`./output/chart-${t.chain}-${t.symbol}.png`, buffer);
  }
  
  console.log('✅ Done! Check ./output folder');
}

main().catch(console.error);
