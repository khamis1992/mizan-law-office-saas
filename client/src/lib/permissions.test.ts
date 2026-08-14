import { describe, expect, it } from 'vitest';
import { can } from './permissions';

describe('office permission matrix', () => {
  it('reserves office administration for the office manager', () => {
    expect(can('manager', 'manage_office')).toBe(true);
    expect(can('lawyer', 'manage_office')).toBe(false);
    expect(can('employee', 'manage_office')).toBe(false);
  });

  it('allows legal work only to lawyers and managers', () => {
    expect(can('lawyer', 'create_case')).toBe(true);
    expect(can('manager', 'use_legal_assistant')).toBe(true);
    expect(can('employee', 'create_case')).toBe(false);
    expect(can('employee', 'use_legal_assistant')).toBe(false);
  });

  it('allows employees to record communications and complete only assigned work', () => {
    expect(can('employee', 'record_communication')).toBe(true);
    expect(can('employee', 'complete_assigned_task')).toBe(true);
    expect(can('employee', 'upload_document')).toBe(false);
  });
});
