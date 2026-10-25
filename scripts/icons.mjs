// Renders public/favicon.svg to the PNG icons the web manifest and apple-touch-icon need.
// Uses Playwright's Chromium, or the one RUMI_E2E_BROWSER points at.
import fs from 'node:fs';
import {chromium} from '@playwright/test';

const svg = fs.readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch(process.env.RUMI_E2E_BROWSER ? {executablePath: process.env.RUMI_E2E_BROWSER} : {});
for (const size of [192, 512]) {
  const page = await browser.newPage({viewport: {width: size, height: size}});
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({path: new URL(`../public/icon-${size}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), omitBackground: true});
  await page.close();
}
await browser.close();
console.log('public/icon-192.png and public/icon-512.png written');
