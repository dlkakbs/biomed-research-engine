import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const outputDir = path.resolve(process.cwd(), 'artifacts', 'screenshots');

const pages = [
  { name: 'landing', url: `${baseUrl}/`, wait: 2500 },
  { name: 'dashboard', url: `${baseUrl}/dashboard`, wait: 2500 },
  { name: 'jobs', url: `${baseUrl}/jobs`, wait: 2500 },
  { name: 'workspace-3604', url: `${baseUrl}/workspace/3604`, wait: 3500 },
  { name: 'results-3604', url: `${baseUrl}/results/3604`, wait: 3500 },
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  deviceScaleFactor: 1.5,
});

for (const pageInfo of pages) {
  const page = await context.newPage();
  console.log(`Capturing ${pageInfo.url}`);
  await page.goto(pageInfo.url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(pageInfo.wait);
  const filePath = path.join(outputDir, `${pageInfo.name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Saved ${filePath}`);
  await page.close();
}

await context.close();
await browser.close();
