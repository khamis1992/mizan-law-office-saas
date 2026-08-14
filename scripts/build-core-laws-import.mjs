import { readFile, writeFile } from 'node:fs/promises';

const laws = [
  {
    file: '/home/ubuntu/upload/www.almeezan.qa_LawView.aspx_opt_LawID_2492_language_ar_1786705515089.md',
    title: 'قانون رقم (13) لسنة 1990 بإصدار قانون المرافعات المدنية والتجارية',
    officialNumber: '13/1990',
    issuedOn: '1990-06-17',
    effectiveOn: '1990-10-15',
    url: 'https://www.almeezan.qa/LawPage.aspx?id=2492&language=ar',
  },
  {
    file: '/home/ubuntu/upload/www.almeezan.qa_LawView.aspx_opt_LawID_26_language_ar_1786705534419.md',
    title: 'قانون رقم (11) لسنة 2004 بإصدار قانون العقوبات',
    officialNumber: '11/2004',
    issuedOn: '2004-05-10',
    effectiveOn: '2004-06-14',
    url: 'https://www.almeezan.qa/LawPage.aspx?id=26&language=ar',
  },
  {
    file: '/home/ubuntu/upload/www.almeezan.qa_LawView.aspx_opt_LawID_3971_language_ar_1786705512506.md',
    title: 'قانون رقم (23) لسنة 2004 بإصدار قانون الإجراءات الجنائية',
    officialNumber: '23/2004',
    issuedOn: '2004-06-30',
    effectiveOn: '2004-10-01',
    url: 'https://www.almeezan.qa/LawPage.aspx?id=3971&language=ar',
  },
];

const version = 'النسخة السارية كما منشورة في بوابة الميزان';
const escapeSql = (value) => value.replaceAll("'", "''");
const blocks = [];

for (const law of laws) {
  const raw = await readFile(law.file, 'utf8');
  const start = raw.indexOf('نحن ');
  if (start < 0) throw new Error(`تعذر تحديد النص القانوني في ${law.file}`);

  const body = raw
    .slice(start)
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const base64 = Buffer.from(body, 'utf8').toString('base64');
  const identity = `source_type = 'law' and official_number = '${law.officialNumber}' and source_version = '${version}'`;

  blocks.push(`
insert into public.legal_sources (
  source_type, title, official_number, issuing_authority, issued_on, effective_on,
  source_url, source_version, is_current
)
values (
  'law',
  '${escapeSql(law.title)}',
  '${law.officialNumber}',
  'دولة قطر',
  date '${law.issuedOn}',
  date '${law.effectiveOn}',
  '${law.url}',
  '${version}',
  true
)
on conflict (source_type, official_number, source_version)
do update set title = excluded.title, source_url = excluded.source_url, is_current = excluded.is_current, updated_at = now();

delete from public.legal_source_sections
where source_id = (select id from public.legal_sources where ${identity});

insert into public.legal_source_sections (source_id, section_order, article_number, heading, body)
select id, 0, 'النص الكامل', '${escapeSql(law.title)}', convert_from(decode('${base64}', 'base64'), 'UTF8')
from public.legal_sources where ${identity};`);
}

await writeFile('/home/ubuntu/supabase_core_laws_import.json', JSON.stringify({
  name: 'import_qatar_core_law_sources',
  project_id: 'mrpdsqbgmlekupjzyswx',
  query: `begin;\n${blocks.join('\n')}\ncommit;`,
}));
