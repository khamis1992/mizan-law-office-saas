-- بحث فوري على مستوى المادة عبر search_vector (كان عموداً معطلاً) بترتيب ts_rank
-- + لوحة «أكثر المصادر استشهاداً» من cited_sources المخزنة.
-- التطبيق على الإنتاج تم 2026-08-16.
begin;

create or replace function public.search_legal_sections(p_query text, p_limit integer default 12)
returns table (id uuid, source_id uuid, article_number text, heading text, snippet text, title text, source_url text, official_number text, rank real)
language sql stable security invoker set search_path = public as $$
  select s.id, s.source_id, s.article_number, s.heading,
         left(s.body, 320) as snippet,
         ls.title, ls.source_url, ls.official_number,
         ts_rank(s.search_vector, q.term_or) as rank
  from public.legal_source_sections s
  join public.legal_sources ls on ls.id = s.source_id
  cross join lateral (
    select coalesce(
      string_agg(to_tsquery('simple', w)::text, ' | ')::tsquery,
      to_tsquery('simple', '')
    ) as term_or
    from unnest(regexp_split_to_array(btrim(coalesce(p_query, '')), '\s+')) w
    where length(w) >= 2
  ) q
  where s.search_vector @@ q.term_or
  order by rank desc, s.section_order
  limit greatest(coalesce(p_limit, 12), 1);
$$;

create or replace function public.most_cited_sources(p_days integer default 90)
returns table (title text, url text, citations bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (select public.is_lawyer_or_manager()) then
    return;
  end if;
  return query
  select (elem->>'title') as title,
         (elem->>'url') as url,
         count(*)::bigint as citations
  from public.assistant_runs ar,
       jsonb_array_elements(ar.cited_sources) elem
  where ar.office_id = (select public.current_office_id())
    and ar.created_at >= now() - (greatest(coalesce(p_days, 90), 1) || ' days')::interval
  group by 1, 2
  order by count(*) desc
  limit 5;
end;
$$;

create index legal_source_sections_source_order_idx on public.legal_source_sections(source_id, section_order);

grant execute on function public.search_legal_sections(text, integer) to authenticated, service_role;
grant execute on function public.most_cited_sources(integer) to authenticated, service_role;

commit;
