import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const baseUrl = 'https://3000-i80waoun7v5kpawef4vlw-868ce110.sg1.manus.computer';
const credentials = { email: 'superadmin@mizan-office.qa', password: 'Mizan!e834e28e8704bc2e33b58e9939fb76919Q' };
const planName = 'خطة اختبار E2E';
const report = { login:false, created:false, updated:false, persisted:false, disabled:false };
const browser = await puppeteer.launch({ executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage'] });
let page; let stage='launch';
const replace = async (selector,value) => { await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.type(selector,value); };
try {
  page = await browser.newPage();
  await page.setViewport({ width:1440,height:1000,deviceScaleFactor:1 });
  stage='open_login';
  await page.goto(baseUrl,{waitUntil:'networkidle2',timeout:30000});
  await page.waitForSelector('input[type="email"]');
  stage='submit_login';
  await page.type('input[type="email"]',credentials.email);await page.type('input[type="password"]',credentials.password);await page.click('form button[type="submit"], form button');
  stage='wait_platform';
  await page.waitForFunction(()=>location.pathname.includes('/platform/')||document.body.innerText.includes('حالة المنصة في لمحة'),{timeout:30000});report.login=true;
  await page.goto(`${baseUrl}/platform/plans`,{waitUntil:'networkidle2',timeout:30000});
  await page.waitForFunction(()=>document.body.innerText.includes('إدارة خطط SaaS'),{timeout:15000});
  await page.type('input[placeholder="اسم الخطة بالعربية"]',planName);
  await page.type('input[placeholder*="رمز الخطة"]','qa-e2e-plan');
  await page.type('input[placeholder="السعر الشهري"]','199');await page.type('input[placeholder="السعر السنوي"]','1990');
  await page.type('input[placeholder="حد المستخدمين"]','8');await page.type('input[placeholder="حد القضايا"]','80');await page.type('input[placeholder="طلبات AI الشهرية"]','30');
  await page.type('textarea[placeholder*="الميزات"]','["تقارير","AI"]');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(x=>x.textContent?.includes('إنشاء الخطة'))?.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await page.waitForFunction(text=>document.body.innerText.includes(text),{},planName);report.created=true;
  stage='edit_plan';
  const editClicked=await page.evaluate(()=>{const row=document.querySelector('[data-testid="plan-row-qa-e2e-plan"]');const button=[...row?.querySelectorAll('button')||[]].find(x=>x.textContent?.trim()==='تعديل');button?.click();return Boolean(button)});if(!editClicked)throw new Error('QA plan edit control was not found');
  await page.waitForFunction(()=>document.querySelector('button')?.textContent?.includes('حفظ التعديل')||document.body.innerText.includes('تعديل الخطة'));
  await replace('input[placeholder="السعر الشهري"]','250');await replace('input[placeholder="السعر السنوي"]','2500');await replace('input[placeholder="حد المستخدمين"]','10');await replace('input[placeholder="حد القضايا"]','100');await replace('input[placeholder="طلبات AI الشهرية"]','40');await replace('textarea[placeholder*="الميزات"]','["تقارير متقدمة","AI موسع"]');
  await new Promise(resolve=>setTimeout(resolve,200));
  await page.click('button[data-testid="plan-save"]');
  await new Promise(resolve=>setTimeout(resolve,1200));
  const saveFeedback=await page.evaluate(()=>({body:document.body.innerText,notifications:[...document.querySelectorAll('[data-sonner-toast]')].map(node=>node.textContent||'')}));
  if(!saveFeedback.body.includes('تم تحديث الخطة.'))throw new Error(`Plan update feedback: ${JSON.stringify(saveFeedback.notifications)}`);report.updated=true;
  stage='verify_plan_persistence';
  await page.reload({waitUntil:'networkidle2',timeout:30000});
  const stored=await page.evaluate(async()=>{const {supabase}=await import('/src/lib/supabase.ts');const {data,error}=await supabase.from('saas_plans').select('monthly_price_qar,annual_price_qar,max_users,max_cases,ai_monthly_requests,features').eq('code','qa-e2e-plan').single();return {data,error:error?.message??null}});
  if(stored.error||stored.data?.monthly_price_qar!==250||stored.data?.annual_price_qar!==2500||stored.data?.max_users!==10||stored.data?.max_cases!==100||stored.data?.ai_monthly_requests!==40||JSON.stringify(stored.data?.features)!==JSON.stringify(['تقارير متقدمة','AI موسع']))throw new Error(`Plan changes were not persisted: ${JSON.stringify(stored)}`);report.persisted=true;
  stage='disable_plan';
  await page.evaluate(()=>{const row=document.querySelector('[data-testid="plan-row-qa-e2e-plan"]');[...row?.querySelectorAll('button')||[]].find(x=>x.textContent?.trim()==='إيقاف')?.click()});
  await page.waitForFunction(text=>document.body.innerText.includes(text),{},'متوقفة');report.disabled=true;
  report.passed=true;
} catch(error){report.passed=false;report.stage=stage;report.url=page?.url();report.body=(await page?.evaluate(()=>document.body.innerText.slice(0,500)))||'';report.error=error instanceof Error?error.message:String(error);process.exitCode=1;}
finally{await browser.close();writeFileSync('/home/ubuntu/e2e-platform-plans-result.json',JSON.stringify(report,null,2));}
