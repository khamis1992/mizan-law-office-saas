import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const baseUrl = 'https://3000-i80waoun7v5kpawef4vlw-868ce110.sg1.manus.computer';
const credentials = { email: 'superadmin@mizan-office.qa', password: 'Mizan!e834e28e8704bc2e33b58e9939fb76919Q' };
const pages = [
  ['overview', 'حالة المنصة في لمحة'],
  ['offices', 'إدارة الخدمة والخطط'],
  ['invoices', 'الفواتير الضريبية'],
  ['recurring', 'الفوترة الدورية'],
  ['users', 'إدارة المستخدمين'],
];
const report = { login: false, desktop: [], mobile: [] };
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
  for (const [route, expected] of pages) {
    await page.goto(`${baseUrl}/platform/${route}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction(text => document.body.innerText.includes(text), { timeout: 15000 }, expected);
    const sidebar = await page.$$eval('aside', items => items.length);
    const headings = await page.$$eval('main h2', items => items.map(item => item.textContent?.trim() || ''));
    if (sidebar !== 1 || !headings.includes(expected)) throw new Error(`Desktop validation failed for ${route}: sidebar=${sidebar}, heading=${headings.join('|')}`);
    await page.screenshot({ path: `/home/ubuntu/e2e-platform-${route}-desktop.png`, fullPage: true });
    report.desktop.push({ route, expected, sidebar, heading: expected });
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  for (const [route, expected] of pages) {
    await page.goto(`${baseUrl}/platform/${route}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction(text => document.body.innerText.includes(text), { timeout: 15000 }, expected);
    const navigation = await page.$$eval('nav', items => items.length);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    const headings = await page.$$eval('main h2', items => items.map(item => item.textContent?.trim() || ''));
    if (navigation < 1 || overflow || !headings.includes(expected)) throw new Error(`Mobile validation failed for ${route}: nav=${navigation}, overflow=${overflow}, heading=${headings.join('|')}`);
    await page.screenshot({ path: `/home/ubuntu/e2e-platform-${route}-mobile.png`, fullPage: true });
    report.mobile.push({ route, expected, navigation, horizontal_overflow: overflow, heading: expected });
  }
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  writeFileSync('/home/ubuntu/e2e-platform-admin-result.json', JSON.stringify(report, null, 2));
}
