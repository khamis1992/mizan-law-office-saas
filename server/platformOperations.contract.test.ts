import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260814_019_platform_operations.sql'), 'utf8');
const completionMigration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260814_021_platform_operations_completion.sql'), 'utf8');
const invitationMigration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260814_022_platform_invitation_management.sql'), 'utf8');
const operations = readFileSync(resolve(process.cwd(), 'client/src/components/PlatformOperations.tsx'), 'utf8');
const pages = readFileSync(resolve(process.cwd(), 'client/src/components/PlatformPages.tsx'), 'utf8');

describe('platform operations contracts', () => {
  it('creates auditable tables for notifications, support, brand and subscription lifecycle events', () => {
    expect(migration).toContain('create table if not exists public.platform_notifications');
    expect(migration).toContain('create table if not exists public.support_tickets');
    expect(migration).toContain('create table if not exists public.platform_brand_settings');
    expect(migration).toContain('create table if not exists public.platform_subscription_events');
  });

  it('restricts platform operations to Super Admin while isolating office support tickets', () => {
    expect(migration).toContain('create policy notifications_platform_admin');
    expect(migration).toContain('create policy tickets_platform_or_office_read');
    expect(migration).toContain('create policy tickets_platform_or_office_insert');
    expect(migration).toContain('platform admin required');
  });

  it('renders distinct navigation pages for every new operational capability', () => {
    for (const section of ['audit', 'alerts', 'plans', 'analytics', 'support', 'brand']) {
      expect(pages).toContain(`id:'${section}'`);
    }
    expect(operations).toContain("if(mode==='audit')");
    expect(operations).toContain("if(mode==='alerts')");
    expect(operations).toContain("if(mode==='support')");
    expect(operations).toContain('sync_platform_notifications');
  });

  it('covers renewal failures, editable messaging, extended plan limits and invitation re-send', () => {
    expect(completionMigration).toContain("'renewal_failed'");
    expect(completionMigration).toContain('message_templates');
    expect(invitationMigration).toContain('invitations_manager_or_platform');
    expect(operations).toContain('resendInvitation');
    expect(operations).toContain('max_cases');
    expect(operations).toContain('ai_monthly_requests');
    expect(operations).toContain('ticketMessages');
  });
});
