import { Scale } from 'lucide-react';

/** هوية ميزان المكتب — المصدر الوحيد للعلامة عبر القشرة الجديدة وصفحات الدخول. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-10 w-10 rounded-xl grid place-items-center bg-[#0d3b36] text-[#e8c377] shadow-lg shadow-[#0d3b36]/20 shrink-0">
        <Scale className="h-5 w-5" />
      </div>
      {!compact && (
        <div>
          <p className="font-bold leading-none text-[#153a36]">ميزان المكتب</p>
          <p className="text-[11px] text-muted-foreground mt-1">إدارة قانونية ذكية</p>
        </div>
      )}
    </div>
  );
}
