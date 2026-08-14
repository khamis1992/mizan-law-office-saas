insert into public.legal_precedents (
  office_id, court_name, reference_number, decided_on, classification, title,
  summary, principle_text, source_url, source_version, is_verified
)
values (
  null,
  'محكمة التمييز - الدائرة المدنية والتجارية',
  '116/2008',
  date '2009-01-27',
  'أسماء تجارية، منافسة غير مشروعة، إثبات، تعويض',
  'الطعن رقم 116 لسنة 2008 تمييز مدني',
  'حكم منشور يتعلق بأسبقية استعمال الاسم التجاري، وحجية إجراءات الإثبات، وحدود المنافسة التجارية غير المشروعة والتعويض عنها.',
  'المنافسة التجارية غير المشروعة فعل تقصيري يستوجب مسؤولية فاعله عن تعويض الضرر متى تجاوزت الأفعال حدود المنافسة المشروعة بقصد إحداث لبس أو اضطراب من شأنه اجتذاب العملاء أو صرفهم. كما أن إجراءات الإثبات ليست أحكاماً قطعية وللمحكمة العدول عنها أو عدم التقيد بنتيجتها مع بيان الأسباب.',
  'https://www.almeezan.qa/RulingPage.aspx?id=449&language=ar',
  'بوابة الميزان - صفحة الحكم المنشورة',
  true
)
on conflict (court_name, reference_number, source_version)
do update set
  classification = excluded.classification,
  title = excluded.title,
  summary = excluded.summary,
  principle_text = excluded.principle_text,
  source_url = excluded.source_url,
  is_verified = true,
  updated_at = now();
