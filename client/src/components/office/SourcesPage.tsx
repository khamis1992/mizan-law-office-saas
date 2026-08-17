import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { BookOpenText, ChevronLeft, Gavel, Search, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, LeadChip, ListPanel, PageHeader, Row, RowMeta, RowTitle } from './office-ui';
import type { LegalSource } from './types';

/**
 * المصادر الموثقة — بعد خطة الاستغلال الأقصى:
 * بحث فوري على مستوى المادة (search_vector/ts_rank) مع احتياط نصي،
 * وعدّاد مواد لكل قانون، وسوابق التمييز، ولوحة «الأكثر استشهاداً».
 */

type ArticleHit = { id: string; source_id: string; article_number: string | null; heading: string | null; snippet: string; title: string; source_url: string; official_number: string | null; rank: number };
type Precedent = { id: string; court_name: string; reference_number: string | null; decided_on: string | null; title: string; summary: string; source_url: string };
type CitedRow = { title: string; url: string; citations: number };

const TYPE_LABELS: Record<string, string> = {
  constitution: 'دستور', law: 'قانون', regulation: 'لائحة', decree: 'مرسوم',
  ministerial_decision: 'قرار وزاري', court_principle: 'مبدأ قضائي', judgment: 'حكم', guide: 'دليل',
};

export default function SourcesPage({ sources, practitioner }: { sources: LegalSource[]; practitioner: boolean }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ArticleHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [precedents, setPrecedents] = useState<Precedent[]>([]);
  const [mostCited, setMostCited] = useState<CitedRow[]>([]);

  useEffect(() => {
    supabase.from('legal_source_sections').select('source_id')
      .like('article_number', 'مادة (%')
      .then(({ data }) => {
        const tally: Record<string, number> = {};
        for (const row of (data ?? []) as Array<{ source_id: string }>) tally[row.source_id] = (tally[row.source_id] ?? 0) + 1;
        setCounts(tally);
      });
    supabase.from('legal_precedents').select('id,court_name,reference_number,decided_on,title,summary,source_url').eq('is_verified', true).limit(8)
      .then(({ data }) => setPrecedents((data ?? []) as Precedent[]));
    if (practitioner) {
      supabase.rpc('most_cited_sources', { p_days: 90 }).then(({ data }) => setMostCited(((data ?? []) as CitedRow[]).filter(row => row.title)));
    }
  }, [practitioner]);

  const runSearch = async (term: string) => {
    setQuery(term);
    if (term.trim().length < 2) { setHits([]); setSearched(false); setFallbackUsed(false); return; }
    const { data: rpcData, error } = await supabase.rpc('search_legal_sections', { p_query: term.trim(), p_limit: 10 });
    if (!error && (rpcData as ArticleHit[] | null)?.length) {
      setHits(rpcData as ArticleHit[]);
      setSearched(true); setFallbackUsed(false);
      return;
    }
    const { data: likeData } = await supabase.from('legal_source_sections')
      .select('id,source_id,article_number,heading,legal_sources(title,source_url,official_number)')
      .ilike('body', `%${term.trim()}%`).limit(8);
    const rows = ((likeData ?? []) as unknown as Array<{ id: string; source_id: string; article_number: string | null; heading: string | null; legal_sources: { title: string; source_url: string; official_number: string | null } | { title: string; source_url: string; official_number: string | null }[] | null }>)
      .map(row => {
        const rel = Array.isArray(row.legal_sources) ? row.legal_sources[0] : row.legal_sources;
        return { id: row.id, source_id: row.source_id, article_number: row.article_number, heading: row.heading, snippet: '', title: rel?.title ?? '', source_url: rel?.source_url ?? '', official_number: rel?.official_number ?? null, rank: 0 } as ArticleHit;
      });
    setHits(rows);
    setSearched(true);
    setFallbackUsed(true);
  };

  const maxCitations = useMemo(() => Math.max(1, ...mostCited.map(row => row.citations)), [mostCited]);

  return (
    <>
      <PageHeader
        eyebrow="قاعدة المعرفة"
        title="المصادر القانونية الموثقة"
        text="بحث فوري على مستوى المادة في النصوص المستوردة، وسجل المصادر الرسمية، وسوابق التمييز الموثقة — لا اعتماد لنص بلا رابط رسمي."
      />

      {practitioner && mostCited.length > 0 && (
        <section className="mz-lift rounded-2xl bg-white shadow-sm p-5 mb-5">
          <h3 className="font-bold text-[#153a36] flex items-center gap-2 mb-4"><TrendingUp className="h-4 w-4 text-[#b58524]" />الأكثر استشهاداً (٩٠ يوماً)</h3>
          <div className="space-y-3">
            {mostCited.map(row => (
              <a key={row.url + row.title} href={row.url} target="_blank" rel="noreferrer" className="block">
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-semibold text-[#153a36] truncate">{row.title}</span>
                  <span className="text-muted-foreground shrink-0 mr-3">{row.citations} استشهاداً</span>
                </div>
                <div className="h-2 rounded-full bg-[#f4f7f5] overflow-hidden">
                  <div className="h-full rounded-full bg-[#21685e]" style={{ width: `${Math.max(8, Math.round(row.citations / maxCitations * 100))}%` }} />
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="rounded-2xl bg-white shadow-sm p-5 mb-5">
        <div className="relative">
          <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input className="pr-9" value={query} onChange={event => runSearch(event.target.value)} placeholder="ابحث على مستوى المادة… مثال: ميعاد الطعن بالنقض" />
        </div>
        {searched && (
          <div className="mt-4 space-y-2">
            {hits.length ? hits.map(hit => (
              <a key={hit.id} href={hit.source_url} target="_blank" rel="noreferrer" className="block border border-[#e5ece9] rounded-xl p-4 hover:bg-[#f8fbfa] transition-colors">
                <div className="flex items-center gap-2 flex-wrap">
                  {hit.article_number && <Badge variant="outline" className="bg-[#edf4f1] text-[#1b6258] border-[#d3e4dd]">{hit.article_number}</Badge>}
                  <p className="font-semibold text-sm text-[#153a36]">{hit.title}</p>
                  {hit.rank > 0 && <Badge variant="outline" className="text-[10px] shrink-0">صلة {Math.round(hit.rank * 10000) / 100}</Badge>}
                </div>
                <p className="text-sm leading-7 mt-2 text-[#153a36] line-clamp-3">{hit.snippet || hit.heading || 'نتيجة مطابقة داخل النص'}</p>
              </a>
            )) : (
              <p className="text-sm text-muted-foreground py-3">
                لا نتائج مطابقة{fallbackUsed ? ' في البحث الاحتياطي' : ''} — استكمل من <a className="text-[#1b6258] font-semibold" href="https://www.almeezan.qa/LawsByYear.aspx?language=ar" target="_blank" rel="noreferrer">بوابة الميزان</a> ثم أضف المصدر عبر مركز البحث عند إعلان الفجوة.
              </p>
            )}
          </div>
        )}
      </div>

      <ListPanel icon={BookOpenText} title="السجل المعتمد" count={sources.length}>
        <div className="divide-y divide-[#f4f7f5]">
          {sources.map(item => (
            <Row key={item.id} onClick={() => window.open(item.source_url, '_blank')} lead={<LeadChip icon={BookOpenText} />}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <RowTitle>{item.title}</RowTitle>
                  <RowMeta>
                    {item.official_number || 'مرجع موثق'} · {item.issued_on || '—'}
                    {counts[item.id] ? ` · ${counts[item.id]} مادة مقسمة` : ''}
                  </RowMeta>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline">{TYPE_LABELS[item.source_type] ?? item.source_type}</Badge>
                  <ChevronLeft className="h-4 w-4 text-[#1b6258]" />
                </div>
              </div>
            </Row>
          ))}
          {!sources.length && <EmptyState icon={BookOpenText} title="لا مصادر معتمدة بعد" text="تُستورد المصادر الرسمية عبر سجل المصادر الموثق." />}
        </div>
      </ListPanel>

      {precedents.length > 0 && (
        <div className="mt-5">
          <ListPanel icon={Gavel} title="سوابق محكمة التمييز الموثقة" count={precedents.length}>
            <div className="divide-y divide-[#f4f7f5]">
              {precedents.map(item => (
                <Row key={item.id} onClick={() => window.open(item.source_url, '_blank')} lead={<LeadChip icon={Gavel} tone="bg-[#fff8e8] text-[#ae7f1e]" />}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <RowTitle>{item.title}</RowTitle>
                      <RowMeta>{item.court_name} · {item.reference_number || 'مرجع غير منشور'} · {item.decided_on || '—'}</RowMeta>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.summary}</p>
                    </div>
                    <ChevronLeft className="h-4 w-4 text-[#1b6258] shrink-0" />
                  </div>
                </Row>
              ))}
            </div>
          </ListPanel>
        </div>
      )}
    </>
  );
}
