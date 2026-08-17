import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const projectUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sourcePath = resolve(process.argv[2] ?? 'supabase/seeds/qatar_legal_sources_snapshot.json');

if (!projectUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to import the legal seed snapshot.');
}

const snapshot = JSON.parse(readFileSync(sourcePath, 'utf8'));
if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.sources) || !Array.isArray(snapshot.sections)) {
  throw new Error('The snapshot format is not supported.');
}

const headers = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal',
};

async function upsert(table, rows) {
  const response = await fetch(`${projectUrl}/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers,
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Supabase import failed for ${table}: ${response.status} ${await response.text()}`);
}

const chunk = (items, size) => items.reduce((batches, item, index) => {
  const batchIndex = Math.floor(index / size);
  (batches[batchIndex] ??= []).push(item);
  return batches;
}, []);

await upsert('legal_sources', snapshot.sources);
for (const batch of chunk(snapshot.sections, 250)) await upsert('legal_source_sections', batch);

console.log(`Imported ${snapshot.sources.length} legal sources and ${snapshot.sections.length} sections from ${sourcePath}`);
