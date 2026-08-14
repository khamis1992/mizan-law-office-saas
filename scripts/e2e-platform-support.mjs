import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const baseUrl = 'https://3000-i80waoun7v5kpawef4vlw-868ce110.sg1.manus.computer';
const credentials = { email: 'superadmin@mizan-office.qa', password: 'Mizan!e834e28e8704bc2e33b58e9939fb76919Q' };
const report = { login:false, ticketCreated:false, noteAdded:false };
const browser = await puppeteer.launch({ executablePath:'/usr/bin/chromium', headless:true, args:['--no-sandbox','--disable-dev-shm-usage'] });
let page; let stage = 'launch';
try {
  page = await browser.newPage();
  await page.setViewport({ width:1440, height:1000, deviceScaleFactor:1 });
  stage = 'open_login';
  await page.goto(baseUrl, { waitUntil:'networkidle2', timeout:30000 });
  await page.waitForSelector('input[type="email"]');
  stage = 'submit_login';
  await page.type('input[type="email"]', credentials.email);
  await page.type('input[type="password"]', credentials.password);
  await page.click('form button[type="submit"], form button');
  stage = 'wait_platform';
  await page.waitForFunction(() => location.pathname.includes('/platform/') || document.body.innerText.includes('حالة المنصة في لمحة'), { timeout:30000 });
  report.login = true;
  await page.goto(`${baseUrl}/platform/support`, { waitUntil:'networkidle2', timeout:30000 });
  await page.waitForFunction(() => document.body.innerText.includes('مركز الدعم'), { timeout:15000 });
  const officeName = 'مكتب اختبار عمليات المنصة';
  const subject = 'تذكرة QA لتدفق مركز الدعم';
  const combos = await page.$$('[role="combobox"]');
  if (!combos[0]) throw new Error('Office selector is unavailable');
  await combos[0].click();
  await page.waitForFunction(name => document.body.innerText.includes(name), {}, officeName);
  await page.evaluate(name => [...document.querySelectorAll('[role="option"]')].find(x=>x.textContent?.includes(name))?.dispatchEvent(new MouseEvent('click',{bubbles:true})), officeName);
  await page.waitForSelector('input[placeholder="موضوع التذكرة"]');
  await page.type('input[placeholder="موضوع التذكرة"]', subject);
  await page.evaluate(() => [...document.querySelectorAll('button')].find(x=>x.textContent?.includes('فتح تذكرة'))?.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await page.waitForFunction(text => document.body.innerText.includes(text), {}, subject);
  report.ticketCreated = true;
  await page.type('input[placeholder="ملاحظة داخلية للفريق…"]', 'ملاحظة QA داخلية');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='إضافة')?.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await page.waitForFunction(() => document.body.innerText.includes('ملاحظة QA داخلية'), { timeout:10000 });
  report.noteAdded = true;
  await page.screenshot({ path:'/home/ubuntu/e2e-platform-support-desktop.png', fullPage:true });
  report.passed = true;
} catch (error) { report.passed=false;report.stage=stage;report.url=page?.url();report.body=(await page?.evaluate(() => document.body.innerText.slice(0,800)))||'';report.error=error instanceof Error?error.message:String(error);process.exitCode=1; }
finally { await browser.close(); writeFileSync('/home/ubuntu/e2e-platform-support-result.json', JSON.stringify(report,null,2)); }
