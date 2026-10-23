-- 020: 구독 "직접 결제" — 토스 결제위젯(카드·퀵계좌이체·토스페이·카카오페이·네이버페이·페이코 등)으로 이용기간을 한 번씩 결제
--      (2026-10-23 사용자 요청: 구독 결제를 ①자동결제(카드·계좌) + ②직접 결제(결제위젯) 둘 다)
--
-- 정책
--   - 직접 결제는 1회 결제다. 결제한 기간(월 1개월 / 연 12개월)만 이용하고, 다음 기간에 자동결제되지 않는다.
--     기간이 끝나기 전에 다시 직접 결제하면 남은 기간 끝에 이어서 연장된다.
--   - 자동결제가 켜져 있는 구독(결제수단 + 자동결제 동의가 있는 trial/active)에서는 직접 결제를 받지 않는다 → 이중 결제 방지.
--     자동결제를 해지했거나, 체험 중 결제수단이 없거나, 이용이 끝난 매장, 이미 직접 결제로 이용 중인 매장만 가능.
--   - 너무 앞당긴 결제 방지: 남은 이용기간이 31일을 넘으면 받지 않는다 (too_early).
--   - 직접 결제 성공 시: 상태 active, 자동결제 동의 기록은 비운다 → 스케줄러(billing_claim_due)가 자동결제하지 않는다.
--     (자동결제로 바꾸려면 결제수단 등록 = 동의 재기록, 또는 등록된 결제수단이 있으면 "자동결제 켜기")
--   - 직접 결제로 이용 중인 구독(active + 자동결제 아님)의 기간이 끝나면 expired(period_ended).
--   - 결제위젯 결제는 서버가 토스 "결제 승인"을 호출해야 완료된다. 결제창을 닫거나 승인하지 않은 주문은 토스가 자동 취소한다.
--     → 새 직접 결제를 시작할 때 이전에 끝나지 않은 직접 결제(pending)는 ABANDONED 로 닫는다 (앱이 먼저 토스 주문 조회로 확인).
--
-- 보안
--   - 시작 함수는 로그인한 대표의 매장만(auth.uid()), 금액·주문번호·기간 기준점은 DB 가 정한다.
--   - 결과 반영 함수는 service_role 전용 (앱 서버가 토스 승인 결과를 확인한 뒤 호출).
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

alter table public.subscription_payments drop constraint subscription_payments_kind_check;
alter table public.subscription_payments add constraint subscription_payments_kind_check check (kind in ('auto', 'manual', 'widget'));

alter table public.subscriptions drop constraint subscriptions_expired_reason_check;
alter table public.subscriptions add constraint subscriptions_expired_reason_check
  check (expired_reason in ('trial_expired', 'payment_failed', 'cancelled', 'period_ended'));

-- 자동결제가 켜져 있는지 (스케줄러가 결제일에 결제하는 구독)
create or replace function public.billing_auto_renewing(s subscriptions)
returns boolean
language sql
stable
set search_path = public
as $$
  select s.status in ('trial', 'active') and s.payment_method_id is not null and s.auto_renew_consented_at is not null
    and exists (select 1 from subscription_payment_methods m where m.id = s.payment_method_id and m.status = 'active')
$$;
revoke all on function public.billing_auto_renewing(subscriptions) from public, anon;

-- ── 직접 결제 시작 (로그인한 대표) ─────────────────────────────────────────
create or replace function public.billing_start_widget(p_cycle text)
returns table (payment_id uuid, order_id text, order_name text, amount int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_business uuid;
  v_role staff_role;
  v_sub subscriptions%rowtype;
  v_pending subscription_payments%rowtype;
  v_price record;
  v_base timestamptz;
  v_pid uuid;
begin
  select p.business_id, p.role into v_business, v_role from profiles p where p.id = auth.uid();
  if v_business is null or v_role is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_cycle not in ('monthly', 'yearly') then raise exception 'invalid_cycle' using errcode = '22023'; end if;
  select * into v_sub from subscriptions s where s.business_id = v_business for update;
  if not found then raise exception 'subscription_not_found' using errcode = 'P0002'; end if;
  if v_sub.status = 'suspended' then raise exception 'suspended' using errcode = '42501'; end if;
  if public.billing_auto_renewing(v_sub) then raise exception 'auto_renew_active' using errcode = '23505'; end if;

  -- 끝나지 않은 결제: 직접 결제는 닫고 새로 시작, 그 외(자동/카드 직접 결제 확인 중)는 기다린다
  select * into v_pending from subscription_payments p where p.subscription_id = v_sub.id and p.status = 'pending' for update;
  if found then
    if v_pending.kind <> 'widget' then raise exception 'payment_in_progress' using errcode = '23505'; end if;
    update subscription_payments
      set status = 'failed', failed_at = now(), failure_code = 'ABANDONED', failure_message = '결제가 완료되지 않았습니다.'
      where id = v_pending.id;
  end if;

  -- 이어서 연장할 기준 시각: 남은 체험/이용기간의 끝, 없으면 지금
  v_base := case
    when v_sub.status = 'trial' and v_sub.trial_ends_at > now() then v_sub.trial_ends_at
    when v_sub.status in ('active', 'canceled') and v_sub.current_period_end > now() then v_sub.current_period_end
    else now() end;
  if v_base > now() + interval '31 days' then raise exception 'too_early' using errcode = '22023'; end if;

  select * into v_price from public.billing_price(p_cycle);
  insert into subscription_payments (business_id, subscription_id, payment_method_id, kind, billing_cycle, amount, supply_amount, vat_amount, due_at, order_id)
  values (v_business, v_sub.id, null, 'widget', p_cycle, v_price.amount, v_price.supply_amount, v_price.vat_amount, v_base,
          'mnsw_' || replace(gen_random_uuid()::text, '-', ''))
  returning id into v_pid;
  return query select p.id, p.order_id, v_price.order_name, p.amount from subscription_payments p where p.id = v_pid;
end;
$$;
revoke all on function public.billing_start_widget(text) from public, anon;
grant execute on function public.billing_start_widget(text) to authenticated;

-- ── 직접 결제 결과 반영 (service_role: 앱 서버가 토스 승인 결과를 확인한 뒤) ───────────
create or replace function public.billing_record_widget_result(
  p_payment_id uuid, p_success boolean, p_toss_payment_key text, p_approved_at timestamptz,
  p_failure_code text, p_failure_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay subscription_payments%rowtype;
  v_sub subscriptions%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := coalesce(p_approved_at, now());
begin
  select * into v_pay from subscription_payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if v_pay.kind <> 'widget' then raise exception 'widget_payment_only' using errcode = '22023'; end if;
  if v_pay.status <> 'pending' then
    return jsonb_build_object('status', v_pay.status, 'already_recorded', true);
  end if;

  if not p_success then
    update subscription_payments
      set status = 'failed', failed_at = now(), failure_code = left(p_failure_code, 100), failure_message = left(p_failure_message, 300)
      where id = v_pay.id;
    return jsonb_build_object('status', 'failed');
  end if;

  if coalesce(p_toss_payment_key, '') = '' then raise exception 'payment_key_required' using errcode = '22023'; end if;
  select * into v_sub from subscriptions where id = v_pay.subscription_id for update;
  -- 시작할 때 정한 기준 시각(남은 기간 끝)부터, 그 시각이 이미 지났으면 결제 시각부터
  v_start := greatest(v_pay.due_at, v_now);
  v_end := v_start + (public.billing_price(v_pay.billing_cycle)).period;
  update subscription_payments
    set status = 'paid', toss_payment_key = p_toss_payment_key, paid_at = v_now, period_start = v_start, period_end = v_end
    where id = v_pay.id;
  update subscriptions
    set status = 'active', billing_cycle = v_pay.billing_cycle, plan = coalesce(plan, 'standard'),
        -- 지금도 이용 중이면 이용 시작 시각은 그대로(체험이면 지금부터), 끊겼다면 결제 시각부터
        current_period_start = case
          when v_start > now() then coalesce(case when v_sub.status in ('active', 'canceled') then v_sub.current_period_start end, now())
          else v_start end,
        current_period_end = v_end,
        expired_reason = null, canceled_at = null,
        auto_renew_consented_at = null, auto_renew_consent_version = null,   -- 직접 결제 = 자동결제 안 함
        last_payment_at = v_now, updated_at = now()
    where id = v_sub.id;
  update trial_history set status = 'ended' where business_id = v_sub.business_id and status = 'active';
  return jsonb_build_object('status', 'paid', 'period_start', v_start, 'period_end', v_end);
end;
$$;
revoke all on function public.billing_record_widget_result(uuid, boolean, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.billing_record_widget_result(uuid, boolean, text, timestamptz, text, text) to service_role;

-- 끝나지 않은 직접 결제 목록 (service_role: 토스 주문 조회로 확정할 때)
create or replace function public.billing_pending_widget(p_business uuid default null)
returns table (payment_id uuid, business_id uuid, order_id text, amount int, requested_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.business_id, p.order_id, p.amount, p.requested_at
  from subscription_payments p
  where p.status = 'pending' and p.kind = 'widget' and (p_business is null or p.business_id = p_business)
  order by p.requested_at
  limit 100
$$;
revoke all on function public.billing_pending_widget(uuid) from public, anon, authenticated;
grant execute on function public.billing_pending_widget(uuid) to service_role;

-- ── 직접 결제로 이용 중인 구독의 기간 종료 → expired(period_ended) ──────────────
create or replace function public.expire_ended_prepaid(p_business uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update subscriptions s set status = 'expired', expired_reason = 'period_ended', updated_at = now()
  where s.status = 'active' and s.current_period_end is not null and s.current_period_end <= now()
    and not public.billing_auto_renewing(s)
    and not exists (select 1 from subscription_payments p where p.subscription_id = s.id and p.status = 'pending')
    and (p_business is null or s.business_id = p_business);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.expire_ended_prepaid(uuid) from public, anon, authenticated;
grant execute on function public.expire_ended_prepaid(uuid) to service_role;

-- 로그인 사용자 화면 진입 시 동기화 (015 정의 + 직접 결제 기간 종료 반영)
create or replace function public.sync_my_subscription()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
begin
  select business_id into v_business from profiles where id = auth.uid();
  if v_business is null then return; end if;
  update subscriptions set status = 'expired', expired_reason = 'trial_expired', updated_at = now()
  where business_id = v_business and status = 'trial' and trial_ends_at <= now()
    and (payment_method_id is null or auto_renew_consented_at is null);
  update trial_history set status = 'ended'
  where business_id = v_business and status = 'active' and trial_ends_at <= now();
  perform public.expire_ended_cancellations(v_business);
  perform public.expire_ended_prepaid(v_business);
end;
$$;

-- ── 자동결제 켜기 (019 정의 + 직접 결제로 이용 중인 구독도 가능) ──────────────────
-- 등록된 결제수단이 있으면, 직접 결제로 이용 중인 기간이 끝날 때부터 자동결제되도록 동의를 기록한다 (지금 결제 없음).
create or replace function public.billing_resume_auto_renewal(p_consent_version text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_role staff_role;
  v_sub subscriptions%rowtype;
  v_from_trial boolean;
  v_has_method boolean;
begin
  select business_id, role into v_business, v_role from profiles where id = auth.uid();
  if v_business is null or v_role is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_consent_version, '') !~ '^[A-Za-z0-9._-]{3,40}$' then raise exception 'consent_required' using errcode = '22023'; end if;
  select * into v_sub from subscriptions where business_id = v_business for update;
  if not found then raise exception 'subscription_not_found' using errcode = 'P0002'; end if;

  if public.billing_auto_renewing(v_sub) then
    return jsonb_build_object('status', v_sub.status, 'already_active', true);
  end if;
  v_has_method := v_sub.payment_method_id is not null
    and exists (select 1 from subscription_payment_methods m where m.id = v_sub.payment_method_id and m.status = 'active');

  -- 직접 결제로 이용 중 (active + 자동결제 아님) → 기간 끝에 자동결제되도록 동의만 기록
  if v_sub.status = 'active' and v_sub.current_period_end > now() then
    if not v_has_method then raise exception 'payment_method_required' using errcode = '22023'; end if;
    update subscriptions set auto_renew_consented_at = now(), auto_renew_consent_version = p_consent_version, updated_at = now()
      where id = v_sub.id;
    return jsonb_build_object('status', 'active', 'next_charge_at', v_sub.current_period_end);
  end if;

  -- 해지 상태 + 이용기간이 남아 있을 때 (019 그대로)
  if v_sub.status <> 'canceled' or v_sub.current_period_end is null or v_sub.current_period_end <= now() then
    raise exception 'not_resumable' using errcode = '22023';
  end if;
  if not v_has_method then raise exception 'payment_method_required' using errcode = '22023'; end if;

  v_from_trial := v_sub.last_payment_at is null
    and v_sub.trial_ends_at is not null and v_sub.current_period_end = v_sub.trial_ends_at;
  if v_from_trial then
    update subscriptions
      set status = 'trial', canceled_at = null, current_period_start = null, current_period_end = null,
          auto_renew_consented_at = now(), auto_renew_consent_version = p_consent_version, updated_at = now()
      where id = v_sub.id;
    return jsonb_build_object('status', 'trial', 'next_charge_at', v_sub.trial_ends_at);
  end if;
  update subscriptions
    set status = 'active', canceled_at = null,
        auto_renew_consented_at = now(), auto_renew_consent_version = p_consent_version, updated_at = now()
    where id = v_sub.id;
  return jsonb_build_object('status', 'active', 'next_charge_at', v_sub.current_period_end);
end;
$$;
revoke all on function public.billing_resume_auto_renewal(text) from public, anon;
grant execute on function public.billing_resume_auto_renewal(text) to authenticated;

-- ROLLBACK (직접 결제 기록이 없을 때만):
--   billing_resume_auto_renewal → 019 정의, sync_my_subscription → 015 정의로 create or replace
--   drop function public.expire_ended_prepaid(uuid); drop function public.billing_pending_widget(uuid);
--   drop function public.billing_record_widget_result(uuid, boolean, text, timestamptz, text, text);
--   drop function public.billing_start_widget(text); drop function public.billing_auto_renewing(subscriptions);
--   subscriptions_expired_reason_check / subscription_payments_kind_check 를 012 값으로 되돌림
