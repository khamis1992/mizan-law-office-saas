# تدقيق ترحيلات Supabase

## نطاق التدقيق

تم التدقيق على مشروع Supabase ذي المرجع `mrpdsqbgmlekupjzyswx` والاسم الظاهر `lywer`، وحالته التشغيلية `ACTIVE_HEALTHY`.

## حالة الترحيلات

كان سجل المشروع يتضمن جميع الترحيلات الأساسية حتى 16 أغسطس، لكنه لم يكن يسجل ملفي `20260817_001_office_legal_features.sql` و`20260817_002_advanced_intelligence.sql` الموجودين محلياً. تحققت المتطلبات الأساسية قبل التنفيذ، ثم طُبقا بنجاح وسُجلا في Supabase بالأسماء `office_legal_features` و`advanced_intelligence`.

تحقق الاستعلام اللاحق من وجود 23 جدولاً جديداً متوقعاً، تشمل فواتير القضايا، تتبع الوقت، قوالب المذكرات، فحوص التعارض، وكلاء القضايا، التوقعات، تحليل الأحكام، الدردشة السياقية، المراجعة التعاونية، وسجل التدقيق القانوني. كما أضيفت ترحيلات `reconcile_case_intake_analyses` و`index_legal_feature_foreign_keys` لتثبيت المخطط التاريخي الناقص وفهارس المفاتيح الخارجية للميزات الجديدة.

## الأمن

كشف مستشار أمان Supabase أن عدداً من دوال `SECURITY DEFINER` كان يرث صلاحية التنفيذ العامة. أضيف ترحيل `20260817_003_restrict_public_security_definer.sql` وحُجبت صلاحية `PUBLIC` مع إعادة منح الصلاحيات الصريحة إلى `authenticated` أو `service_role` بحسب الاستخدام. يؤكد التحقق المباشر أن دور `anon` لا يستطيع تنفيذ الدوال الحساسة المختبرة، بينما بقيت دوال المستخدمين والخادم اللازمة مفعلة للأدوار المقصودة.

تبقى تحذيرات مستشار الأمان الخاصة بدوال يمكن للمستخدم الموثق تنفيذها، وهي دوال تستخدمها مسارات التطبيق وتتحقق من الدور/النطاق داخلياً. كما بقيت ملاحظتا إعدادات Auth حول حماية كلمات المرور المسربة وخيارات MFA، وهما إعدادان على مستوى لوحة Supabase لا يمكن تغييرهما بترحيل SQL.

## الأداء

أظهر فحص الأداء عدداً كبيراً من ملاحظات المفاتيح الخارجية غير المفهرسة. عولجت الجداول التي أضيفت أو وُفقت في هذا التدقيق بفهارس تغطي مفاتيح القضية والمستخدم والمسودة والمكتب ذات الصلة. يعرض الفحص اللاحق ملاحظات «فهرس غير مستخدم» طبيعية للجداول الجديدة أو قليلة البيانات؛ لا تُحذف هذه الفهارس قبل وجود بيانات حمل فعلية ومراجعة خطط التنفيذ. أما ملاحظات المفاتيح الخارجية القديمة خارج وحدات الذكاء القانوني فتظل مسار تحسين مستقل لتجنب تعديل شامل غير متدرج للقاعدة القائمة.

## تسوية التاريخ

أضيفت خريطة مطابقة صريحة حتى لا تبقى ترحيلات تاريخية غير مفسرة. الترحيلات البذرية للمصادر القانونية (`import_qatar_permanent_constitution` و`import_qatar_core_law_sources`) ممثلة الآن بلقطة محلية قابلة لإعادة التشغيل في `supabase/seeds/qatar_legal_sources_snapshot.json`، مع برنامجي `scripts/export-qatar-legal-seed.mjs` و`scripts/import-qatar-legal-seed.mjs`. تحتوي اللقطة على مصدر دستوري واحد وثلاثة مصادر قانونية و1,346 قسماً، وتستبعد الحقول المولدة والمتجهات حتى يظل الاستيراد متوافقاً مع المخطط الجديد.

| ترحيل Supabase المسجل | التمثيل المحلي أو القرار النهائي |
|---|---|
| `reset_and_create_qatar_law_office_core`، `restrict_law_office_function_execution` | `20260814_001_law_office_reset.sql` و`20260814_002_restrict_function_execution.sql`. |
| `import_qatar_permanent_constitution`، `import_qatar_core_law_sources` | `supabase/seeds/qatar_legal_sources_snapshot.json` مع أدوات التصدير والاستيراد التكراريتين في `scripts/`. |
| `seed_verified_qatar_precedent`، `seed_verified_qatar_precedents_batch`، `harden_employee_sensitive_writes` | `20260814_003` إلى `20260814_005`. |
| `saas_platform_admin` إلى `fix_service_role_alert_sync` | `20260814_006` إلى `20260814_023` بحسب الاسم الوظيفي المقابل. |
| `ai_platform_products`، `fix_quota_return_next` | `20260816_001_ai_platform_products.sql`؛ تعريف الحصة المحلي يتضمن مسار `return next` المتوافق مع التصحيح المسجل. |
| `split_laws_into_articles` | `20260816_002_split_laws_into_articles.sql`. |
| `sources_search_and_citation_analytics`، `fix_search_legal_sections_or_terms`، `search_rpc_returns_full_body` | `20260816_003_sources_search_and_analytics.sql` بعد تحديث تعريف البحث ليعيد `body` و`effective_on` و`is_current` كما في Supabase. |
| `case_intake_analyses` | `20260817_004_reconcile_case_intake_analyses.sql`؛ يعيد تمثيل الجدول والقيود وسياسات RLS بعملية متكررة آمنة. |
| `office_legal_features`، `advanced_intelligence` | `20260817_001_office_legal_features.sql` و`20260817_002_advanced_intelligence.sql`. |
| `restrict_public_security_definer`، `index_legal_feature_foreign_keys` | `20260817_003_restrict_public_security_definer.sql` و`20260817_005_index_legal_feature_foreign_keys.sql`. |
