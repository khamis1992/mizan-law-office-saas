-- تقسيم النصوص القانونية الكاملة إلى مواد مستقلة:
-- استشهاد دقيق بالمادة والرقم، وترتيب أدق، وبوابة تحقق على مستوى المادة.
-- التطبيق على الإنتاج تم 2026-08-16 (أنشأ 1342 قسماً: دستور 133 + عقوبات 222 + مرافعات 538 + إجراءات 449 + 4 تماهيد).
begin;

create or replace function public.split_law_sections() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_parts text[];
  v_num text;
  v_order integer;
  v_count integer := 0;
  v_i integer;
begin
  for r in
    select s.id, s.source_id, s.body
    from public.legal_source_sections s
    where s.article_number = 'النص الكامل'
      and not exists (
        select 1 from public.legal_source_sections a
        where a.source_id = s.source_id and a.article_number is distinct from 'النص الكامل'
      )
  loop
    v_parts := regexp_split_to_array(r.body, '(?m)(?=\s*المادة\s+\d{1,3})');
    v_order := 0;

    if length(btrim(coalesce(v_parts[1], ''))) > 40 then
      insert into public.legal_source_sections (source_id, section_order, article_number, heading, body)
      values (r.source_id, 0, null, 'التمهيد', btrim(v_parts[1]));
      v_count := v_count + 1;
    end if;

    for v_i in 2..coalesce(array_length(v_parts, 1), 1) loop
      v_num := (regexp_match(v_parts[v_i], 'المادة\s+(\d{1,3})'))[1];
      if v_num is not null then
        v_order := v_order + 1;
        insert into public.legal_source_sections (source_id, section_order, article_number, heading, body)
        values (r.source_id, v_order, 'مادة (' || v_num || ')', 'المادة ' || v_num, btrim(v_parts[v_i]));
        v_count := v_count + 1;
      end if;
    end loop;

    delete from public.legal_source_sections where id = r.id;
  end loop;

  return v_count;
end;
$$;

-- ملاحظة تشغيلية: النصوص الأصلية المستوردة مبتورة (العقوبات حتى مادة 218/410،
-- الدستور 149، المرافعات 573/584) — يلزم استيراد مكمل من بوابة الميزان لاحقاً.

commit;
