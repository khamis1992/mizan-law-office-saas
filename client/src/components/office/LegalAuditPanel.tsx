import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { trpcClient } from '@/lib/trpc';
import { Loader2, ScrollText } from 'lucide-react';

/**
 * سجل التدقيق القانوني — أثر كامل لكل تعديل على المسودات والقضايا والفواتير:
 * من، متى، ماذا (قبل/بعد). متاح لمدير المكتب.
 */

type AuditEntry = { id: number; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; before: unknown; after: unknown; created_at: string };

const ACTION_LABELS: Record<string, string> = {
  draft_comment_added: 'تعليق على مسودة',
  draft_revised: 'تعديل مسودة',
  approval_workflow_started: 'بدء سير اعتماد',
  approval_approve: 'اعتماد مسودة',
  approval_reject: 'رفض مسودة',
};

export function LegalAuditPanel({ accessToken, manager }: { accessToken: string; manager: boolean }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    const result = await trpcClient.legalIntelligence.audit.query({ accessToken, limit: 50 }).catch(() => [] as AuditEntry[]);
    setEntries(result as AuditEntry[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [accessToken]);

  if (!manager) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">سجل التدقيق متاح لمدير المكتب فقط.</CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="text-lg text-[#153a36] flex gap-2"><ScrollText className="h-5 w-5 text-[#b58524]" />سجل التدقيق القانوني</CardTitle>
          <CardDescription>أثر كامل لكل تعديل: من، متى، ماذا — مطلوب مهنياً عند النزاعات مع العملاء.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'تحديث'}</Button>
      </CardHeader>
      <CardContent>
        {entries.length ? (
          <div className="divide-y divide-[#f4f7f5] max-h-[480px] overflow-y-auto">
            {entries.map(entry => (
              <div key={entry.id} className="py-3 flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#153a36]">{ACTION_LABELS[entry.action] ?? entry.action}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {entry.entity_type} · {entry.entity_id?.slice(0, 8) ?? '—'}
                    {entry.after && typeof entry.after === 'object' && 'step' in (entry.after as Record<string, unknown>) ? ` · الخطوة: ${String((entry.after as Record<string, unknown>).step)}` : ''}
                  </p>
                </div>
                <div className="text-left shrink-0">
                  <p className="text-[11px] text-muted-foreground">{new Date(entry.created_at).toLocaleString('ar-QA')}</p>
                  <Badge variant="outline" className="text-[10px] mt-1">الممثل: {entry.actor_id?.slice(0, 8) ?? 'نظام'}</Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">لا أحداث تدقيق مسجلة بعد — تظهر التعديلات على المسودات والقرارات تلقائياً.</p>
        )}
      </CardContent>
    </Card>
  );
}
