import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../supabase/migrations/20260814_001_law_office_reset.sql', import.meta.url), 'utf8');
const hardeningMigration = readFileSync(new URL('../supabase/migrations/20260814_004_role_hardening.sql', import.meta.url), 'utf8');

describe('Supabase RLS contract', () => {
  it('enables RLS on the core office records and scopes reads to the current office', () => {
    for (const table of ['clients', 'legal_cases', 'hearings', 'tasks', 'documents', 'assistant_runs']) {
      expect(migration).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(migration).toContain("office_id = (select public.current_office_id())");
  });

  it('limits legal work creation to lawyers or managers and office invitations to managers', () => {
    expect(migration).toContain('create policy cases_insert on public.legal_cases');
    expect(migration).toContain('(select public.is_lawyer_or_manager())');
    expect(migration).toContain('create policy invitations_manager_all on public.office_invitations');
    expect(migration).toContain('(select public.is_manager())');
  });

  it('keeps document storage paths isolated by office folder', () => {
    expect(migration).toContain("create policy legal_documents_select on storage.objects");
    expect(migration).toContain("(storage.foldername(name))[1] = (select public.current_office_id())::text");
  });

  it('prevents employees from creating sensitive client records and document metadata', () => {
    expect(hardeningMigration).toContain('create policy clients_insert_professional');
    expect(hardeningMigration).toContain('create policy documents_insert_professional');
    expect(hardeningMigration).toContain('(select public.is_lawyer_or_manager())');
  });

  it('documents and restricts the security-definer helpers to signed-in users', () => {
    expect(migration).toContain('revoke all on all functions in schema public from public, anon, authenticated;');
    expect(migration).toContain('grant execute on function public.current_office_id() to authenticated, service_role;');
    expect(migration).toContain('grant execute on function public.is_manager() to authenticated, service_role;');
    expect(migration).toContain('alter default privileges in schema public revoke execute on functions from public, anon, authenticated;');
  });
});
