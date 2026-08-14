import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const baseUrl = 'https://3000-i80waoun7v5kpawef4vlw-868ce110.sg1.manus.computer';
const credentials = { email: 'superadmin@mizan-office.qa', password: 'Mizan!e834e28e8704bc2e33b58e9939fb76919Q' };
const email = 'qa-resend-invite@mizan-office.qa';
const report = { login:false, invitationVisible:false, resent:false };
const browser = await puppeteer.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
let page; let stage='launch';
try {
  page=await browser.newPage();await page.setViewport({width:1440,height:1000});stage='open_login';await page.goto(baseUrl,{waitUntil:'networkidle2',timeout:30000});await page.waitForSelector('input[type="email"]');stage='submit_login';await page.type('input[type="email"]',credentials.email);await page.type('input[type="password"]',credentials.password);await page.click('form button[type="submit"], form button');stage='wait_platform';await page.waitForFunction(()=>location.pathname.includes('/platform/')||document.body.innerText.includes('حالة المنصة في لمحة'),{timeout:30000});report.login=true;
  await page.goto(`${baseUrl}/platform/users`,{waitUntil:'networkidle2',timeout:30000});await page.waitForFunction(value=>document.body.innerText.includes(value),{},email);report.invitationVisible=true;
  const clicked=await page.evaluate(value=>{const row=[...document.querySelectorAll('div')].find(el=>el.textContent?.includes(value)&&el.textContent?.includes('إعادة إرسال'));const button=[...row?.querySelectorAll('button')||[]].find(el=>el.textContent?.includes('إعادة إرسال'));button?.dispatchEvent(new MouseEvent('click',{bubbles:true}));return Boolean(button)},email);if(!clicked)throw new Error('Resend invitation control was not found');await new Promise(resolve=>setTimeout(resolve,1000));report.resent=true;report.passed=true;
}catch(error){report.passed=false;report.stage=stage;report.url=page?.url();report.body=(await page?.evaluate(()=>document.body.innerText.slice(0,500)))||'';report.error=error instanceof Error?error.message:String(error);process.exitCode=1;}
finally{await browser.close();writeFileSync('/home/ubuntu/e2e-platform-invitation-resend-result.json',JSON.stringify(report,null,2));}
