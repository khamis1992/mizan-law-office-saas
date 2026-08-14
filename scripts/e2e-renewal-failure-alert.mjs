import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const baseUrl = 'https://3000-i80waoun7v5kpawef4vlw-868ce110.sg1.manus.computer';
const credentials = { email: 'superadmin@mizan-office.qa', password: 'Mizan!e834e28e8704bc2e33b58e9939fb76919Q' };
const report = { login: false, alertVisible: false, severityVisible: false, desktop: false, mobile: false };
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', credentials.email);
  await page.type('input[type="password"]', credentials.password);
  await page.click('form button[type="submit"], form button');
  await page.waitForFunction(() => location.pathname.includes('/platform/') || document.body.innerText.includes('إدارة المنصة المركزية'), { timeout: 20000 });
  report.login = true;
  await page.goto(`${baseUrl}/platform/alerts`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes('فشل تجديد الاشتراك'), { timeout: 15000 });
  report.alertVisible = true;
  report.severityVisible = await page.evaluate(() => document.body.innerText.includes('critical'));
  if (!report.severityVisible) throw new Error('Renewal-failure severity was not rendered');
  await page.screenshot({ path: '/home/ubuntu/e2e-renewal-failure-alert-desktop.png', fullPage: true });
  report.desktop = true;
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/platform/alerts`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes('فشل تجديد الاشتراك'), { timeout: 15000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  if (overflow) throw new Error('Mobile alert page has horizontal overflow');
  await page.screenshot({ path: '/home/ubuntu/e2e-renewal-failure-alert-mobile.png', fullPage: true });
  report.mobile = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  writeFileSync('/home/ubuntu/e2e-renewal-failure-alert-result.json', JSON.stringify(report, null, 2));
}
