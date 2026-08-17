import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type LegalSeedSnapshot = {
  schemaVersion: number;
  sourceProjectRef: string;
  sources: Array<{ id: string; source_type: string; source_url: string; office_id: string | null; imported_by: string | null }>;
  sections: Array<{ id: string; source_id: string; section_order: number; body: string; search_vector?: unknown; embedding?: unknown }>;
};

describe('Qatar legal seed snapshot', () => {
  const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), 'supabase/seeds/qatar_legal_sources_snapshot.json'), 'utf8')) as LegalSeedSnapshot;

  it('contains the verified official source set and all stored sections', () => {
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.sourceProjectRef).toBe('mrpdsqbgmlekupjzyswx');
    expect(snapshot.sources).toHaveLength(4);
    expect(snapshot.sections).toHaveLength(1346);
    expect(snapshot.sources.map(source => source.source_type).sort()).toEqual(['constitution', 'law', 'law', 'law']);
    expect(snapshot.sources.every(source => source.source_url.includes('almeezan.qa'))).toBe(true);
  });

  it('keeps global legal sources and excludes generated or embedding fields', () => {
    expect(snapshot.sources.every(source => source.office_id === null && source.imported_by === null)).toBe(true);
    expect(snapshot.sections.every(section => section.id && section.source_id && section.section_order >= 0 && section.body.length > 0)).toBe(true);
    expect(snapshot.sections.every(section => !('search_vector' in section) && !('embedding' in section))).toBe(true);
  });
});
