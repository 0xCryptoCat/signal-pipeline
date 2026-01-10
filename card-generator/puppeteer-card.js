/**
 * Puppeteer Card Generator for Vercel Serverless
 * Uses @sparticuz/chromium for AWS Lambda/Vercel compatibility
 * 
 * This renders the full HTML/CSS design with all effects
 */

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { generatePnlCardHtml } from './pnl-generator.js';

// Configure chromium for serverless
chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

/**
 * Get browser instance
 */
async function getBrowser() {
  // Check if running on Vercel/AWS (has LAMBDA_TASK_ROOT or AWS_LAMBDA_FUNCTION_NAME)
  const isServerless = !!process.env.AWS_LAMBDA_FUNCTION_NAME || !!process.env.VERCEL;
  
  if (isServerless) {
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  } else {
    // Local development - use installed Chrome
    return puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: process.platform === 'darwin' 
        ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        : process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/usr/bin/google-chrome',
    });
  }
}

/**
 * Generate PnL card using Puppeteer
 * Returns PNG buffer
 */
export async function generatePnlCard(data) {
  let browser = null;
  
  try {
    // Generate HTML
    const html = generatePnlCardHtml(data);
    
    // Launch browser
    browser = await getBrowser();
    const page = await browser.newPage();
    
    // Set viewport to card dimensions
    await page.setViewport({
      width: 1200,
      height: 675,
      deviceScaleFactor: 2, // Retina quality
    });
    
    // Load HTML
    await page.setContent(html, {
      waitUntil: ['load', 'networkidle0'],
    });
    
    // Wait for fonts to load
    await page.evaluate(() => document.fonts.ready);
    
    // Take screenshot
    const screenshot = await page.screenshot({
      type: 'png',
      clip: {
        x: 0,
        y: 0,
        width: 1200,
        height: 675,
      },
    });
    
    return screenshot;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export default { generatePnlCard };
