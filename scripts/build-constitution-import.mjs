import { readFile, writeFile } from 'node:fs/promises';

const sourceFile = '/home/ubuntu/upload/www.almeezan.qa_LawView.aspx_opt_LawID_2284_language_ar_1786705185749.md';
const raw = await readFile(sourceFile, 'utf8');

const start = raw.indexOf('نحن حمد بن خليفة آل ثاني أمير دولة قطر');
const end = raw.length;
if (start < 0 || end <= start) {
  throw new Error('تعذر تحديد حدود النص الرسمي للدستور في المصدر المحفوظ.');
}

const body = raw
  .slice(start, end)
  .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const bodyBase64 = Buffer.from(body, 'utf8').toString('base64');
const sql = `begin;

insert into public.legal_sources (
  source_type, title, official_number, issuing_authority, issued_on, effective_on,
  source_url, source_version, is_current
)
values (
  'constitution',
  'الدستور الدائم لدولة قطر',
  '0',
  'دولة قطر',
  date '2004-06-08',
  date '2005-06-09',
  'https://www.almeezan.qa/LawPage.aspx?id=2284&language=ar',
  'النسخة السارية كما منشورة في بوابة الميزان',
  true
)
on conflict (source_type, official_number, source_version)
do update set
  title = excluded.title,
  source_url = excluded.source_url,
  is_current = excluded.is_current,
  updated_at = now();

delete from public.legal_source_sections
where source_id = (
  select id from public.legal_sources
  where source_type = 'constitution'
    and official_number = '0'
    and source_version = 'النسخة السارية كما منشورة في بوابة الميزان'
);

insert into public.legal_source_sections (source_id, section_order, article_number, heading, body)
select id, 0, 'النص الكامل', 'الدستور الدائم لدولة قطر', convert_from(decode('${bodyBase64}', 'base64'), 'UTF8')
from public.legal_sources
where source_type = 'constitution'
  and official_number = '0'
  and source_version = 'النسخة السارية كما منشورة في بوابة الميزان';

commit;`;

await writeFile('/home/ubuntu/supabase_constitution_import.json', JSON.stringify({
  name: 'import_qatar_permanent_constitution',
  project_id: 'mrpdsqbgmlekupjzyswx',
  query: sql,
}));

await writeFile('/home/ubuntu/qatar-law-office-erp/docs/legal-source-register.md', `# سجل المصادر القانونية\n\n| المصدر | حالة الاستيراد | المرجع الرسمي | ملاحظة التحقق |\n|---|---:|---|---|\n| الدستور الدائم لدولة قطر | مستعد للاستيراد | https://www.almeezan.qa/LawPage.aspx?id=2284&language=ar | النص مستخرج من بوابة الميزان ويجب اعتماد الاستشهاد النهائي من رابط المادة المعني. |\n| التشريعات والقرارات القطرية | فهرسة المصدر | https://www.almeezan.qa/LawsByYear.aspx?language=ar | البوابة تعرض التشريعات السارية والمعدلة والملغاة. |\n| أحكام محكمة التمييز | فهرسة المصدر | https://www.almeezan.qa/RulingsSearch.aspx?language=ar | تضاف فقط الأحكام أو المبادئ التي توثق برابطها الرسمي. |\n\nلا يعتبر أي نص أو حكم داخلي صالحاً للاعتماد ما لم يحتفظ برابط المصدر الرسمي وحالة تحقق واضحة.\n`);
