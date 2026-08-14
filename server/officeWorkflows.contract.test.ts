import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const home = readFileSync(new URL('../client/src/pages/Home.tsx', import.meta.url), 'utf8');
const policies = readFileSync(new URL('../supabase/migrations/20260814_001_law_office_reset.sql', import.meta.url), 'utf8');
const hardening = readFileSync(new URL('../supabase/migrations/20260814_004_role_hardening.sql', import.meta.url), 'utf8');

describe('office workflow contract', () => {
  it('wires core CRUD workflows to the intended Supabase tables', () => {
    for (const table of ['clients', 'legal_cases', 'hearings', 'tasks', 'documents', 'client_communications']) {
      expect(home).toContain(`supabase.from('${table}')`);
    }
    expect(home).toContain("update({ status: 'completed'");
    expect(home).toContain("update({ status: data.get('status') as string, outcome:");
  });

  it('preserves the office boundary for all core workflow tables', () => {
    for (const table of ['clients', 'legal_cases', 'hearings', 'tasks', 'documents', 'client_communications']) {
      expect(policies).toContain(`alter table public.${table} enable row level security;`);
    }
    expect(policies).toContain("office_id = (select public.current_office_id())");
  });

  it('applies frontend guards and database restrictions to employee-sensitive actions', () => {
    expect(home).toContain("!practitioner && ['client', 'case', 'hearing', 'task', 'doc'].includes(kind)");
    expect(home).toContain("kind === 'invite' && !manager");
    expect(home).toContain("if (!canCompleteTask(task))");
    expect(hardening).toContain('create policy clients_insert_professional');
    expect(hardening).toContain('create policy documents_insert_professional');
  });
});
