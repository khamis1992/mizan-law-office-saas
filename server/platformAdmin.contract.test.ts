import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../supabase/migrations/20260814_006_saas_platform_admin.sql', import.meta.url), 'utf8');
const userManagementMigration = readFileSync(new URL('../supabase/migrations/20260814_007_platform_user_management.sql', import.meta.url), 'utf8');
const autoSubscriptionMigration = readFileSync(new URL('../supabase/migrations/20260814_008_auto_trial_subscription.sql', import.meta.url), 'utf8');
const maintenanceMigration = readFileSync(new URL('../supabase/migrations/20260814_009_platform_maintenance_guard.sql', import.meta.url), 'utf8');
const home = readFileSync(new URL('../client/src/pages/Home.tsx', import.meta.url), 'utf8');
const app = readFileSync(new URL('../client/src/App.tsx', import.meta.url), 'utf8');
const platformPages = readFileSync(new URL('../client/src/components/PlatformPages.tsx', import.meta.url), 'utf8');

describe('SaaS platform administration contract', () => {
  it('defines a central Super Admin, subscription catalog, and office subscriptions', () => {
    expect(migration).toContain('create table public.platform_admins');
    expect(migration).toContain('create table public.saas_plans');
    expect(migration).toContain('create table public.office_subscriptions');
    expect(migration).toContain("'trial', 'تجربة مجانية'");
    expect(migration).toContain("'professional', 'احترافي'");
  });

  it('keeps platform administration separate from tenant business data', () => {
    expect(migration).toContain('create or replace function public.is_platform_admin()');
    expect(migration).toContain('create policy offices_select_platform');
    expect(migration).toContain('create policy subscriptions_platform_write');
    expect(migration).toContain('create trigger guard_cases_office_state');
    expect(migration).toContain('create trigger guard_documents_office_state');
  });

  it('routes verified platform admins to the central dashboard instead of tenant setup', () => {
    expect(home).toContain("supabase.from('platform_admins')");
    expect(home).toContain('return <PlatformPages');
    expect(app).toContain('path="/platform/:section"');
    expect(platformPages).toContain("href={`/platform/${item.id}`}");
  });

  it('enables safe platform user management and a default trial for every new office', () => {
    expect(userManagementMigration).toContain('not public.is_manager() and not public.is_platform_admin()');
    expect(autoSubscriptionMigration).toContain('create trigger create_default_office_subscription');
    expect(autoSubscriptionMigration).toContain("'trialing'");
    expect(maintenanceMigration).toContain("current_setting('app.allow_platform_maintenance', true) = 'true'");
  });
});
