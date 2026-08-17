import { Badge } from '@/components/ui/badge';
import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, BriefcaseBusiness, CalendarClock, ClipboardCheck, FileSignature, FileText, Search, SearchCheck, UploadCloud, UserPlus, Users } from 'lucide-react';
import type { Client, Hearing, LegalCase, OfficeDocument, Task } from '@/components/office/types';

/**
 * لوحة الأوامر (Ctrl+K): بحث فوري في قضايا المكتب وعملائه وجلساته ومهامه
 * + إجراءات سريعة — تجربة التنقل الجوهرية الجديدة بدل التنقل عبر القوائم فقط.
 */

type Page = 'dashboard' | 'cases' | 'schedule' | 'clients' | 'research' | 'contracts' | 'agents' | 'office';
type ModalKind = 'client' | 'case' | 'hearing' | 'task' | 'doc';

type Props = {
  open: boolean;
  onClose: () => void;
  cases: LegalCase[];
  clients: Client[];
  hearings: Hearing[];
  tasks: Task[];
  documents: OfficeDocument[];
  canCreate: boolean;
  onNavigate: (page: Page) => void;
  onOpenCase: (caseId: string) => void;
  onAction: (modal: ModalKind) => void;
};

type Item = { id: string; kind: 'action' | 'case' | 'client' | 'hearing' | 'task' | 'page'; label: string; hint: string; icon: typeof Search; run: () => void };

const KIND_TONES: Record<string, string> = {
  action: 'bg-[#0d3b36] text-[#e8c377]',
  case: 'bg-[#edf4f1] text-[#1b6258]',
  client: 'bg-[#fff8e8] text-[#ae7f1e]',
  hearing: 'bg-amber-50 text-amber-700',
  task: 'bg-blue-50 text-blue-700',
  page: 'bg-slate-100 text-slate-600',
};

export default function CommandPalette({ open, onClose, cases, clients, hearings, tasks, documents, canCreate, onNavigate, onOpenCase, onAction }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQuery(''); setActive(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const caseById = (id?: string | null) => cases.find(item => item.id === id);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();
    const actions: Item[] = canCreate ? [
      { id: 'a-case', kind: 'action', label: 'تسجيل قضية جديدة', hint: 'إجراء', icon: BriefcaseBusiness, run: () => onAction('case') },
      { id: 'a-client', kind: 'action', label: 'إضافة عميل', hint: 'إجراء', icon: UserPlus, run: () => onAction('client') },
      { id: 'a-hearing', kind: 'action', label: 'جدولة جلسة', hint: 'إجراء', icon: CalendarClock, run: () => onAction('hearing') },
      { id: 'a-task', kind: 'action', label: 'إنشاء مهمة', hint: 'إجراء', icon: ClipboardCheck, run: () => onAction('task') },
      { id: 'a-doc', kind: 'action', label: 'رفع مستند', hint: 'إجراء', icon: UploadCloud, run: () => onAction('doc') },
    ] : [];
    const pages: Item[] = [
      { id: 'p-research', kind: 'page', label: 'فتح مركز البحث الموثق', hint: 'الذكاء القانوني', icon: SearchCheck, run: () => onNavigate('research') },
      { id: 'p-contracts', kind: 'page', label: 'فتح استديو العقود', hint: 'الذكاء القانوني', icon: FileSignature, run: () => onNavigate('contracts') },
      { id: 'p-agents', kind: 'page', label: 'فتح الوكلاء القانونيين', hint: 'الذكاء القانوني', icon: Bot, run: () => onNavigate('agents') },
    ];
    const caseItems: Item[] = cases.map(item => ({
      id: `c-${item.id}`, kind: 'case' as const,
      label: `${item.case_number} — ${item.title}`,
      hint: `قضية · ${clients.find(client => client.id === item.client_id)?.full_name ?? 'عميل غير محدد'}`,
      icon: BriefcaseBusiness, run: () => onOpenCase(item.id),
    }));
    const clientItems: Item[] = clients.map(item => ({
      id: `cl-${item.id}`, kind: 'client' as const, label: item.full_name,
      hint: `عميل · ${item.kind === 'company' ? 'شركة' : 'فرد'}`, icon: Users,
      run: () => onNavigate('clients'),
    }));
    const hearingItems: Item[] = hearings.filter(item => item.status === 'scheduled').map(item => ({
      id: `h-${item.id}`, kind: 'hearing' as const,
      label: `${caseById(item.case_id)?.title ?? 'قضية'} — ${new Intl.DateTimeFormat('ar-QA', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(item.hearing_at))}`,
      hint: `جلسة قادمة · ${item.court_name ?? 'المحكمة غير محددة'}`, icon: CalendarClock,
      run: () => onOpenCase(item.case_id),
    }));
    const docItems: Item[] = documents.map(item => ({
      id: `d-${item.id}`, kind: 'page' as const, label: item.file_name,
      hint: `مستند · ${cases.find(legalCase => legalCase.id === item.case_id)?.case_number ?? 'غير مرتبط بقضية'}`, icon: FileText,
      run: () => { if (item.case_id) onOpenCase(item.case_id); else onNavigate('office'); },
    }));
    const taskItems: Item[] = tasks.filter(item => item.status !== 'completed').map(item => ({
      id: `t-${item.id}`, kind: 'task' as const, label: item.title,
      hint: `مهمة · ${caseById(item.case_id)?.case_number ?? 'عامة'}`, icon: ClipboardCheck,
      run: () => onNavigate('schedule'),
    }));

    const all = [...actions, ...pages, ...caseItems, ...clientItems, ...hearingItems, ...docItems, ...taskItems];
    if (!q) return [...actions, ...pages, ...caseItems.slice(0, 5)];
    return all.filter(item => `${item.label} ${item.hint}`.toLowerCase().includes(q)).slice(0, 14);
  }, [query, cases, clients, hearings, tasks, canCreate, onAction, onNavigate, onOpenCase]);

  useEffect(() => { setActive(0); }, [query]);

  if (!open) return null;

  const runItem = (item: Item) => { onClose(); item.run(); };

  return (
    <div className="fixed inset-0 z-[60] px-4 pt-[12vh]" dir="rtl" onKeyDown={event => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, items.length - 1)); }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); }
      if (event.key === 'Enter' && items[active]) { event.preventDefault(); runItem(items[active]); }
    }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-[#092a26]/45 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, y: -14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }} className="relative max-w-xl mx-auto rounded-2xl bg-white shadow-2xl overflow-hidden border border-[#e5ece9]">
        <div className="flex items-center gap-3 px-4 h-14 border-b border-[#e5ece9]">
          <Search className="h-4 w-4 text-[#b58524] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="ابحث بقضية أو عميل أو موعد… أو نفّذ إجراءً"
            className="flex-1 bg-transparent outline-none text-sm text-[#153a36] placeholder:text-muted-foreground"
          />
          <kbd className="text-[10px] font-bold bg-[#f4f7f5] border border-[#e5ece9] rounded-md px-1.5 py-0.5 text-[#5d716c]">ESC</kbd>
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
          {items.length ? items.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onMouseEnter={() => setActive(index)}
                onClick={() => runItem(item)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 h-12 text-right transition-colors ${index === active ? 'bg-[#e9f2ef]' : 'hover:bg-[#f8fbfa]'}`}
              >
                <div className={`h-8 w-8 rounded-lg grid place-items-center shrink-0 ${KIND_TONES[item.kind]}`}><Icon className="h-4 w-4" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#153a36] truncate">{item.label}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{item.hint}</p>
                </div>
                {index === active && <Badge variant="outline" className="text-[10px] shrink-0 bg-white">Enter</Badge>}
              </button>
            );
          }) : (
            <p className="py-10 text-center text-sm text-muted-foreground">لا نتائج مطابقة — جرّب كلمة أخرى أو استخدم الإجراءات السريعة.</p>
          )}
        </div>
        <div className="h-9 px-4 flex items-center gap-4 border-t border-[#e5ece9] bg-[#f8fbfa] text-[11px] text-muted-foreground">
          <span>↑↓ للتنقل</span><span>Enter للفتح</span><span>ESC للإغلاق</span>
          <span className="mr-auto">ميزان المكتب · البحث الموحد</span>
        </div>
      </motion.div>
    </div>
  );
}

