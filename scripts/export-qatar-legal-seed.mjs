import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectUrl = process.env.SUPABASE_URL ?? 'https://mrpdsqbgmlekupjzyswx.supabase.co';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const destination = resolve(process.argv[2] ?? 'supabase/seeds/qatar_legal_sources_snapshot.json');

if (!serviceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to export the legal seed snapshot.');
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
};

async function readJson(path) {
  const response = await fetch(`${projectUrl}/rest/v1/${path}`, { headers });
  if (!response.ok) throw new Error(`Supabase export failed for ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function readAllSections() {
  const batchSize = 250;
  const rows = [];
  for (let offset = 0; ; offset += batchSize) {
    const page = await readJson(`legal_source_sections?select=id,source_id,section_order,article_number,heading,body,created_at&order=source_id.asc,section_order.asc&limit=${batchSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < batchSize) return rows;
  }
}

const sources = await readJson('legal_sources?select=id,office_id,source_type,title,official_number,issuing_authority,issued_on,effective_on,source_url,source_version,is_current,imported_at,imported_by,created_at,updated_at&order=source_type.asc,title.asc');
const sections = await readAllSections();

const snapshot = {
  schemaVersion: 1,
  exportedAt: new Date().toISOString(),
  sourceProjectRef: 'mrpdsqbgmlekupjzyswx',
  sources,
  sections,
};

mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Exported ${sources.length} legal sources and ${sections.length} sections to ${destination}`);
