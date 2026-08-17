import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * نظام تصميم «ميزان المكتب» — اللغة البصرية الموحدة لصفحات الإدارة.
 * الألوان هي هوية المنتج القائمة حرفياً: أخضر عميق #0d3b36/#153a36/#1b6258،
 * ذهبي #b58524/#e8c377، وخلفيات #f4f7f5/#edf4f1 — بلا أي لون جديد.
 * البنية: رأس صفحة واحد + لوحات قوائم بأقسام — لا بطاقات حرة.
 */

const TONE_MAP: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  on_hold: 'bg-amber-50 text-amber-700 border-amber-200',
  appeal: 'bg-violet-50 text-violet-700 border-violet-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
  archived: 'bg-slate-100 text-slate-600 border-slate-200',
  scheduled: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  held: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  postponed: 'bg-amber-50 text-amber-700 border-amber-200',
  cancelled: 'bg-slate-100 text-slate-600 border-slate-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  not_started: 'bg-slate-100 text-slate-600 border-slate-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
};

export function statusTone(value?: string | null) {
  return TONE_MAP[value ?? ''] ?? 'bg-slate-100 text-slate-600 border-slate-200';
}

export function PageHeader({ eyebrow, title, text, action }: { eyebrow: string; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-5">
      <div>
        <p className="text-[11px] tracking-[.14em] font-bold text-[#b58524]">{eyebrow}</p>
        <h1 className="text-2xl sm:text-3xl font-bold mt-1.5 text-[#153a36]">{title}</h1>
        <p className="text-sm leading-6 text-muted-foreground mt-2 max-w-2xl">{text}</p>
      </div>
      {action}
    </div>
  );
}

export function ListPanel({ icon: Icon, title, count, actions, children }: {
  icon: typeof import('lucide-react').BookOpenText;
  title: string;
  count?: number | string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mz-lift rounded-2xl bg-white shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-3 flex items-center gap-2 border-b border-[#e5ece9]">
        <Icon className="h-5 w-5 text-[#b58524]" />
        <h2 className="font-bold text-[#153a36]">{title}</h2>
        {count !== undefined && <Badge variant="outline" className="bg-[#f4f7f5] border-[#e5ece9] text-[#1b6258]">{count}</Badge>}
        {actions && <div className="mr-auto flex gap-2 items-center">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Row({ lead, children, onClick }: { lead: ReactNode; children: ReactNode; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn('flex items-center gap-3.5 px-5 py-4', onClick && 'cursor-pointer hover:bg-[#f8fbfa] transition-colors')}
    >
      {lead}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

export function LeadChip({ icon: Icon, tone = 'bg-[#edf4f1] text-[#1b6258]' }: { icon?: typeof import('lucide-react').BookOpenText; tone?: string }) {
  return (
    <div className={cn('h-10 w-10 rounded-xl grid place-items-center shrink-0', tone)}>
      {Icon && <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />}
    </div>
  );
}

export function LeadInitial({ letter, tone = 'bg-[#edf4f1] text-[#1b6258]' }: { letter: string; tone?: string }) {
  return (
    <div className={cn('h-10 w-10 rounded-xl grid place-items-center shrink-0 font-bold', tone)}>{letter}</div>
  );
}

export function RowTitle({ children }: { children: ReactNode }) {
  return <p className="font-semibold text-sm text-[#153a36] truncate">{children}</p>;
}

export function RowMeta({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground mt-0.5 truncate">{children}</p>;
}

export function FilterChips<T extends string>({ options, value, onChange }: { options: Array<{ id: T; label: string; count?: number }>; value: T; onChange: (next: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {options.map(option => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            'h-9 px-4 rounded-full text-sm font-medium transition-colors border',
            value === option.id ? 'bg-[#0d3b36] text-white border-[#0d3b36]' : 'bg-white text-[#5d716c] border-[#e5ece9] hover:bg-[#f4f7f5]',
          )}
        >
          {option.label}
          {option.count !== undefined && <span className={cn('mr-1.5 text-xs', value === option.id ? 'text-[#e8c377]' : 'text-muted-foreground')}>{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: typeof import('lucide-react').BookOpenText; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="py-12 text-center px-6">
      <div className="h-12 w-12 mx-auto grid place-items-center rounded-xl bg-[#edf4f1] text-[#1b6258]"><Icon className="h-6 w-6" /></div>
      <p className="font-semibold mt-4 text-[#153a36]">{title}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto leading-6">{text}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function PrimaryButton({ children, onClick, icon: Icon }: { children: ReactNode; onClick?: () => void; icon?: typeof import('lucide-react').BookOpenText }) {
  return (
    <Button className="bg-[#0d3b36] hover:bg-[#164d45] h-11" onClick={onClick}>
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </Button>
  );
}
