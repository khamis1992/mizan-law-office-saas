begin;

alter table public.platform_brand_settings add column if not exists message_templates jsonb not null default jsonb_build_object(
  'trial_ending', 'مرحباً، تنتهي تجربتكم قريباً. يرجى مراجعة الاشتراك.',
  'payment_overdue', 'يوجد رصيد مستحق على اشتراك مكتبكم. يرجى مراجعة الفاتورة.',
  'renewal_failed', 'تعذر تجديد الاشتراك تلقائياً. يرجى التواصل مع الدعم.'
);

create or replace function public.sync_platform_notifications()
returns integer language plpgsql security definer set search_path = public as $$
declare inserted_count integer := 0;
declare caller_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if not public.is_platform_admin() and caller_role <> 'service_role' then
    raise exception 'platform admin required';
  end if;
  insert into public.platform_notifications(category, severity, title_ar, body_ar, office_id, subscription_id, metadata)
  select case
           when s.status in ('past_due','expired') then 'renewal_failed'
           when s.status = 'trialing' then 'trial_ending'
           else 'billing_due'
         end,
         case when s.status in ('past_due','expired') then 'critical' else 'warning' end,
         case
           when s.status in ('past_due','expired') then 'فشل تجديد الاشتراك'
           when s.status = 'trialing' then 'تجربة قاربت على الانتهاء'
           else 'تجديد اشتراك مستحق'
         end,
         case
           when s.status in ('past_due','expired') then 'تعذر تجديد اشتراك ' || o.name || '. راجع الفاتورة أو حالة الاشتراك.'
           else 'يتطلب اشتراك ' || o.name || ' مراجعة من مسؤول المنصة.'
         end,
         o.id, s.id, jsonb_build_object('status', s.status, 'period_ends_at', s.current_period_ends_at)
  from public.office_subscriptions s join public.offices o on o.id = s.office_id
  where (s.status in ('past_due','expired') or s.current_period_ends_at <= now() + interval '7 days')
    and not exists (select 1 from public.platform_notifications n where n.subscription_id = s.id and n.read_at is null and n.created_at > now() - interval '24 hours');
  get diagnostics inserted_count = row_count;
  return inserted_count;
end $$;

commit;
