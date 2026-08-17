import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { roleLabel } from '@/lib/office-utils';
import { UserPlus, Users } from 'lucide-react';
import { EmptyState, LeadInitial, ListPanel, PageHeader, Row, RowMeta, RowTitle } from './office-ui';
import type { LegalCase, Profile } from './types';

export default function TeamPage({ team, cases, manager, onInvite }: {
  team: Profile[];
  cases: LegalCase[];
  manager: boolean;
  onInvite: () => void;
}) {
  const activeMembers = team.filter(member => member.is_active);
  const loadOf = (member: Profile) => cases.filter(item => item.responsible_lawyer_id === member.id && ['new', 'active', 'on_hold', 'appeal'].includes(item.status)).length;

  return (
    <>
      <PageHeader
        eyebrow="تنظيم الفريق"
        title="المحامون والموظفون"
        text="أعضاء المكتب وأدوارهم وعبء القضايا النشط لكل محامٍ — ودعوات مقيّدة بالدور."
        action={manager ? <Button className="bg-[#0d3b36] hover:bg-[#164d45] h-11" onClick={onInvite}><UserPlus className="h-4 w-4" />دعوة عضو</Button> : undefined}
      />
      {team.length ? (
        <ListPanel icon={Users} title="أعضاء المكتب" count={team.length}>
          <div className="divide-y divide-[#f4f7f5]">
            {team.map(member => (
              <Row key={member.id} lead={
                <LeadInitial
                  letter={member.display_name.charAt(0)}
                  tone={member.role === 'manager' ? 'bg-[#0d3b36] text-[#e8c377]' : member.role === 'lawyer' ? 'bg-[#edf4f1] text-[#1b6258]' : 'bg-slate-100 text-slate-600'}
                />
              }>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <RowTitle>{member.display_name || 'عضو جديد'}</RowTitle>
                      {!member.is_active && <Badge variant="outline" className="bg-slate-100 text-slate-600">معطل</Badge>}
                    </div>
                    <RowMeta><span dir="ltr">{member.email || '—'}</span>{['manager', 'lawyer'].includes(member.role) ? ` · ${loadOf(member)} قضية نشطة` : ''}</RowMeta>
                  </div>
                  <Badge variant="outline" className="shrink-0">{roleLabel(member.role)}</Badge>
                </div>
              </Row>
            ))}
          </div>
        </ListPanel>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm">
          <EmptyState icon={UserPlus} title="الفريق لا يزال فارغاً" text="أضف المحامين والموظفين بدعوات مقيّدة بالدور." action={manager ? <Button className="bg-[#0d3b36]" onClick={onInvite}><UserPlus className="h-4 w-4" />دعوة عضو</Button> : undefined} />
        </div>
      )}
    </>
  );
}
