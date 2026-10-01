-- 017: 자동결제 해지 ↔ 결과 미확정(pending) 자동결제 안전 처리 (S-3, 2026-10-01 승인 설계)
--
-- 문제 (012~015 기준)
--   - billing_claim_due() 는 구독 상태와 상관없이 pending 자동결제를 모두 돌려주고, 앱은 같은 멱등키로 "다시 결제 요청"했다.
--     → 결제일에 응답이 유실된 뒤 대표가 해지하면, 다음 실행에서 해지된 구독에 결제가 다시 요청될 수 있었다.
--   - billing_record_result() 는 성공 시 구독 상태와 상관없이 status = 'active' 로 덮어썼다.
--     → 해지가 사라지고 다음 달부터 자동결제가 다시 이어졌다. 실패 시에는 해지 구독도 expired(payment_failed) 로 바뀌었다.
--   - billing_cancel_auto_renewal() 은 이용기간이 지난 뒤(결제 확인 중)에는 해지를 거부했다.
--
-- 정책 (변경 없음): 해지 = 즉시 중단 아님, 결제된 기간까지 이용, 다음 결제부터 자동결제 중단, 부분환불 없음,
--                  결제 실패 시 연장 없음, 성공한 결제의 기간은 제공, 해지 구독을 결제 성공으로 active 로 되돌리지 않음.
--
-- 이 파일이 하는 일
--   1) billing_cancel_auto_renewal(): 자동결제가 걸린 구독(active / 카드 등록 체험)은 시점과 관계없이 해지를 항상 접수한다.
--      기간은 줄이지 않는다 (이용기간이 이미 끝났으면 곧바로 expired(cancelled) 로 정리된다).
--   2) billing_record_result(): 해지된 구독(canceled, 또는 해지 후 기간이 끝난 expired(cancelled))의 자동결제는
--      성공 → 상태는 canceled 유지 + 결제된 기간만 반영, 실패 → 구독 상태 변경 없음.
--      결제 승인 시각이 해지 시각보다 늦으면(정상 흐름과 다름) 자동 환불하지 않고 관리자 확인 대상으로 기록한다.
--      해지되지 않은 구독·직접 결제는 012 동작 그대로.
--   3) billing_close_pending(): 결제가 일어나지 않은 pending 자동결제를 구독 상태를 바꾸지 않고 종료하는 서버 전용 함수.
--   4) billing_claim_due(): 반환 행에 requested_at / is_new(이번 실행에서 만든 결제) / retry_allowed(지금 다시 결제해도 되는
--      상태 = 구독 trial·active + 동의 기록 + 결제 당시 카드가 지금도 현재 카드) 를 추가한다. 결제 대상 선정 규칙은 015 그대로.
--   5) subscription_payments_auto_once: 결제가 일어나지 않은 채 종료된(NOT_PROCESSED) pending 은 같은 결제일의 새 시도를 막지 않는다.
--      (예: 결제 확인 중 카드를 바꾼 체험/구독 → 다음 실행에서 새 카드로 결제. 해지 구독은 결제 대상이 아니므로 해당 없음.
--       실제 결제 실패는 그대로 1회로 끝난다: 실패하면 구독이 expired 가 되어 결제 대상에서 빠진다)
--
-- 적용 순서: 012 → 013 → 014 → 015 → 016 → 017 을 한 점검 시간에 적용하고 곧바로 새 앱 코드를 배포한다.
--   (billing_claim_due 의 반환 형식이 바뀌므로 017 과 새 cron 코드는 함께 나가야 한다)
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

-- ── 관리자 확인 표시 (브라우저 권한에는 열지 않는다: 012 의 컬럼 단위 GRANT 에 포함하지 않음) ──
alter table public.subscription_payments
  add column review_required boolean not null default false,
  add column review_reason text check (review_reason ~ '^[a-z_]{3,40}$');

-- ── 같은 결제일 자동결제 1회 제한: 결제 요청 없이 종료된 시도(NOT_PROCESSED)는 세지 않는다 ──
drop index public.subscription_payments_auto_once;
create unique index subscription_payments_auto_once on public.subscription_payments (subscription_id, due_at)
  where kind = 'auto' and not (status = 'failed' and failure_code = 'NOT_PROCESSED');

-- ── 1) 해지: 자동결제가 걸린 구독이면 항상 접수 (013 정의에서 "이용기간 안" 조건만 제거) ──
create or replace function public.billing_cancel_auto_renewal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_role staff_role;
  v_sub subscriptions%rowtype;
begin
  select business_id, role into v_business, v_role from profiles where id = auth.uid();
  if v_business is null or v_role is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_sub from subscriptions where business_id = v_business for update;
  if not found then raise exception 'subscription_not_found' using errcode = 'P0002'; end if;

  if v_sub.status = 'canceled' then
    return jsonb_build_object('status', 'canceled', 'already_canceled', true, 'period_end', v_sub.current_period_end, 'canceled_at', v_sub.canceled_at);
  end if;

  if v_sub.status = 'active' then
    -- 결제한 이용기간은 그대로. 결제일 당일·결제 확인 중(pending)이어도 접수한다.
    update subscriptions set status = 'canceled', canceled_at = now(), updated_at = now() where id = v_sub.id;
    perform public.expire_ended_cancellations(v_business);   -- 이용기간이 이미 끝났으면 곧바로 expired(cancelled)
    return jsonb_build_object('status', 'canceled', 'period_end', v_sub.current_period_end, 'canceled_at', now());
  end if;

  if v_sub.status = 'trial' and v_sub.payment_method_id is not null then
    -- 카드를 등록한 체험: 체험 종료 시각까지 이용, 체험 종료일 자동결제는 하지 않는다 (013 과 같은 기간 표기)
    update subscriptions
      set status = 'canceled', canceled_at = now(), current_period_start = v_sub.trial_started_at,
          current_period_end = v_sub.trial_ends_at, updated_at = now()
      where id = v_sub.id;
    perform public.expire_ended_cancellations(v_business);
    return jsonb_build_object('status', 'canceled', 'period_end', v_sub.trial_ends_at, 'canceled_at', now());
  end if;

  -- 카드 없는 체험 / 이미 만료·정지: 해지할 자동결제가 없다
  raise exception 'not_cancellable' using errcode = '22023';
end;
$$;

-- ── 2) 결제 결과 반영 (012 정의 + 해지 구독 처리 + 관리자 확인 표시) ──
create or replace function public.billing_record_result(
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
  v_canceled boolean;
  v_review boolean := false;
begin
  select * into v_pay from subscription_payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if v_pay.status <> 'pending' then
    return jsonb_build_object('status', v_pay.status, 'already_recorded', true);
  end if;
  select * into v_sub from subscriptions where id = v_pay.subscription_id for update;
  -- 해지된 구독의 자동결제: 해지 상태 그대로(canceled), 또는 해지 후 기간이 끝나 expired(cancelled) 가 된 상태
  v_canceled := v_pay.kind = 'auto'
    and (v_sub.status = 'canceled' or (v_sub.status = 'expired' and v_sub.expired_reason = 'cancelled'));

  if p_success then
    if coalesce(p_toss_payment_key, '') = '' then raise exception 'payment_key_required' using errcode = '22023'; end if;
    v_start := coalesce(p_approved_at, now());
    v_end := (case when v_pay.kind = 'auto' then v_pay.due_at else v_start end) + (public.billing_price(v_pay.billing_cycle)).period;
    update subscription_payments
      set status = 'paid', toss_payment_key = p_toss_payment_key, paid_at = coalesce(p_approved_at, now()),
          period_start = v_start, period_end = v_end
      where id = v_pay.id;

    if v_canceled then
      -- 이미 결제된 기간만 반영하고 해지는 유지한다 → active 로 되돌리지 않으므로 다음 자동결제 대상이 되지 않는다.
      update subscriptions
        set status = 'canceled', billing_cycle = v_pay.billing_cycle,
            current_period_start = v_start, current_period_end = v_end, expired_reason = null,
            last_payment_at = coalesce(p_approved_at, now()), updated_at = now()
        where id = v_sub.id;
      update trial_history set status = 'ended' where business_id = v_sub.business_id and status = 'active';
      -- 해지 이후에 승인된 결제(또는 승인 시각을 알 수 없음)는 정상 흐름이 아니다: 자동 환불하지 않고 관리자 확인 대상으로 남긴다.
      v_review := v_sub.canceled_at is null or p_approved_at is null or p_approved_at > v_sub.canceled_at;
      if v_review then
        update subscription_payments set review_required = true, review_reason = 'approved_after_cancel' where id = v_pay.id;
        perform public.audit_write(v_sub.business_id, null, 'system', 'billing.review_required', 'subscription_payment', v_pay.id, 'success',
          jsonb_build_object('reason', 'approved_after_cancel'));
      end if;
      return jsonb_build_object('status', 'paid', 'canceled', true, 'review_required', v_review, 'period_start', v_start, 'period_end', v_end);
    end if;

    update subscriptions
      set status = 'active', billing_cycle = v_pay.billing_cycle, plan = coalesce(plan, 'standard'),
          current_period_start = v_start, current_period_end = v_end, expired_reason = null,
          last_payment_at = coalesce(p_approved_at, now()), updated_at = now()
      where id = v_sub.id;
    update trial_history set status = 'ended' where business_id = v_sub.business_id and status = 'active';
    return jsonb_build_object('status', 'paid', 'period_start', v_start, 'period_end', v_end);
  end if;

  update subscription_payments
    set status = 'failed', failed_at = now(), failure_code = left(p_failure_code, 100), failure_message = left(p_failure_message, 300)
    where id = v_pay.id;
  -- 자동결제 실패: 해지되지 않은 구독만 즉시 expired(payment_failed). 해지 구독은 상태를 바꾸지 않는다(해지 기간 유지).
  if v_pay.kind = 'auto' and not v_canceled then
    update subscriptions set status = 'expired', expired_reason = 'payment_failed', updated_at = now() where id = v_sub.id;
    update trial_history set status = 'ended' where business_id = v_sub.business_id and status = 'active';
  end if;
  return jsonb_build_object('status', 'failed', 'canceled', v_canceled);
end;
$$;

-- ── 3) 결제가 일어나지 않은 pending 자동결제 종료 (구독 상태는 바꾸지 않는다) ──
--   p_code: NOT_PROCESSED(토스에 결제 기록 없음 → 결제 안 됨) / UNEXPECTED_PAYMENT_RESULT(토스 기록이 요청과 다름 → 관리자 확인) 등
create or replace function public.billing_close_pending(p_payment_id uuid, p_code text, p_review boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay subscription_payments%rowtype;
begin
  if coalesce(p_code, '') !~ '^[A-Z_]{3,40}$' then raise exception 'invalid_code' using errcode = '22023'; end if;
  select * into v_pay from subscription_payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if v_pay.kind <> 'auto' then raise exception 'auto_payment_only' using errcode = '22023'; end if;
  if v_pay.status <> 'pending' then
    return jsonb_build_object('status', v_pay.status, 'already_recorded', true);
  end if;
  update subscription_payments
    set status = 'failed', failed_at = now(), failure_code = p_code,
        failure_message = case when p_review then '결제 결과 확인이 필요합니다.' else '결제 요청이 처리되지 않았습니다.' end,
        review_required = coalesce(p_review, false),
        review_reason = case when p_review then lower(p_code) end
    where id = v_pay.id;
  if p_review then
    perform public.audit_write(v_pay.business_id, null, 'system', 'billing.review_required', 'subscription_payment', v_pay.id, 'success',
      jsonb_build_object('reason', lower(p_code)));
  end if;
  return jsonb_build_object('status', 'failed', 'closed', true, 'review_required', coalesce(p_review, false));
end;
$$;
revoke all on function public.billing_close_pending(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.billing_close_pending(uuid, text, boolean) to service_role;

-- ── 4) 자동결제 대상 확보 (015 정의 + 반환 행에 재처리 판단용 정보) ──
drop function public.billing_claim_due(int);
create function public.billing_claim_due(p_limit int default 50)
returns table (payment_id uuid, business_id uuid, order_id text, order_name text, amount int, customer_key text, billing_key_enc text,
               requested_at timestamptz, is_new boolean, retry_allowed boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_today_end timestamptz := (date_trunc('day', now() at time zone 'Asia/Seoul') + interval '1 day') at time zone 'Asia/Seoul';
  r record;
  v_price record;
  v_pid uuid;
begin
  -- (015 그대로) 카드가 없거나 자동결제 동의 기록이 없는 체험은 종료 시 expired(trial_expired)
  update subscriptions set status = 'expired', expired_reason = 'trial_expired', updated_at = now()
  where status = 'trial' and (payment_method_id is null or auto_renew_consented_at is null) and trial_ends_at <= now();
  update trial_history set status = 'ended' where status = 'active' and trial_ends_at <= now();

  -- (015 그대로) 결제일이 된 trial / active 구독에 자동결제 1건 생성. canceled 는 대상이 아니다.
  for r in
    select s.id, s.business_id, s.billing_cycle, s.payment_method_id,
           case when s.status = 'trial' then s.trial_ends_at else s.current_period_end end as due_at
    from subscriptions s
    join subscription_payment_methods m on m.id = s.payment_method_id and m.status = 'active'
    where s.billing_cycle is not null
      and s.auto_renew_consented_at is not null
      and ((s.status = 'trial' and s.trial_ends_at < v_today_end)
        or (s.status = 'active' and s.current_period_end < v_today_end))
      and not exists (select 1 from subscription_payments p where p.subscription_id = s.id and p.status = 'pending')
    order by 5
    limit p_limit
    for update of s skip locked
  loop
    select * into v_price from public.billing_price(r.billing_cycle);
    insert into subscription_payments (business_id, subscription_id, payment_method_id, kind, billing_cycle, amount, supply_amount, vat_amount, due_at, order_id)
    values (r.business_id, r.id, r.payment_method_id, 'auto', r.billing_cycle, v_price.amount, v_price.supply_amount, v_price.vat_amount, r.due_at,
            'mnsa_' || replace(gen_random_uuid()::text, '-', ''))
    on conflict do nothing
    returning id into v_pid;
  end loop;

  -- 새로 만든 것 + 결과를 확정하지 못한 이전 pending.
  --   is_new: 이번 실행(같은 트랜잭션)에서 만든 결제 → 바로 결제 요청
  --   retry_allowed: 이전 pending 을 다시 결제해도 되는 상태인지 (구독 trial/active + 동의 기록 + 결제 당시 카드 = 현재 카드)
  --   → 앱은 이전 pending 을 먼저 토스 주문번호로 조회하고, 기록이 없을 때만 retry_allowed 인 경우에 같은 멱등키로 다시 요청한다.
  return query
    select p.id, p.business_id, p.order_id, (public.billing_price(p.billing_cycle)).order_name, p.amount, m.customer_key, m.billing_key_enc,
           p.requested_at,
           p.requested_at = now(),
           (s.status in ('trial', 'active') and s.auto_renew_consented_at is not null
             and s.payment_method_id = p.payment_method_id and m.status = 'active')
    from subscription_payments p
    join subscription_payment_methods m on m.id = p.payment_method_id
    join subscriptions s on s.id = p.subscription_id
    where p.status = 'pending' and p.kind = 'auto'
    order by p.requested_at
    limit p_limit;
end;
$$;
revoke all on function public.billing_claim_due(int) from public, anon, authenticated;
grant execute on function public.billing_claim_due(int) to service_role;

-- ROLLBACK (수동, 필요 시 — 앱 코드도 017 이전 버전으로 함께 되돌린다):
--   drop function public.billing_close_pending(uuid, text, boolean);
--   billing_claim_due 는 drop 후 015 정의로 재생성, billing_record_result 는 012 정의로, billing_cancel_auto_renewal 은 013 정의로 create or replace
--   drop index public.subscription_payments_auto_once;
--   create unique index subscription_payments_auto_once on public.subscription_payments (subscription_id, due_at) where kind = 'auto';
--   alter table public.subscription_payments drop column review_reason, drop column review_required;
