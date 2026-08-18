# بذور المصادر القانونية القطرية

يحفظ الملف `qatar_legal_sources_snapshot.json` نسخة قابلة لإعادة التشغيل من المصادر القانونية الرسمية وأقسامها المهيكلة. لا يتضمن الحقول المولدة (`search_vector`) أو المتجهات (`embedding`)؛ تعيد قاعدة البيانات توليد الحقل المولد، وتنفذ فهارس/وظائف البحث عملية التضمين لاحقاً عند الحاجة.

## تصدير لقطة محدثة من المشروع المرجعي

```bash
SUPABASE_URL=https://mrpdsqbgmlekupjzyswx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/export-qatar-legal-seed.mjs
```

## استيراد اللقطة إلى مشروع مهيأ بالترحيلات

```bash
SUPABASE_URL=<target-project-url> \
SUPABASE_SERVICE_ROLE_KEY=<target-service-role-key> \
node scripts/import-qatar-legal-seed.mjs
```

الاستيراد تكراري وآمن؛ يستخدم `id` كمفتاح تعارض ويطبق المصادر قبل الأقسام. يجب تنفيذ ترحيلات المخطط أولاً، وبالأخص ترحيل تقسيم الأقسام وفهارس البحث.
