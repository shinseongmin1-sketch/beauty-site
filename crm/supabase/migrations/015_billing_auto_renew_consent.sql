-- 015: 자동결제 동의 기록 (동의 시각 + 동의 문구 버전)
--
-- 설계
--   - subscriptions 에 auto_renew_consented_at / auto_renew_consent_version 추가 (nullable: 기존 행·카드 없는 체험은 null 그대로).
--   - 기록은 서버 전용 함수 안에서만 한다: 카드 연결(billing_attach_method)·직접 결제 시작(billing_start_manual)이
--     동의 문구 버전을 필수 인자로 받아, 같은 트랜잭션에서 동의 시각(now())과 버전을 저장한다.
--       → 카드 등록이 실패하면(연결 함수가 호출되지 않거나 실패) 동의 기록도 남지 않는다 (부분 기록 없음).
--       → 브라우저 권한(authenticated)은 subscriptions 쓰기 권한이 없고 이 함수들의 실행 권한도 없다 → 동의 기록 조작 불가.
--   - 동의 없이는 자동결제가 설정되지 않는다:
--       카드 연결·직접 결제 시작은 버전 인자가 없으면 거부, 스케줄러는 동의 기록이 없는 구독을 결제하지 않는다.
--       (동의 없이 카드만 남은 체험은 체험 종료 시 카드 없는 체험과 똑같이 expired(trial_expired) 처리)
--   - 문구 자체(법률 확정 전)는 DB 에 두지 않는다. 버전 식별자만 저장하고, 문구는 앱의 버전 상수가 가리킨다.
--   - 카드 변경도 같은 연결 함수를 거치므로 동의를 다시 받는다: 카드 변경 화면에서 결제 주기(월/연, 금액)를 함께 다시 고르므로
--     금액·주기에 대한 최신 동의를 남기는 편이 안전하다.
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

alter table public.subscriptions
  add column auto_renew_consented_at timestamptz,
  add column auto_renew_consent_version text check (auto_renew_consent_version ~ '^[A-Za-z0-9._-]{3,40}$');

-- ── 카드 연결 (012 정의 + 동의 기록, 동의 버전 필수) ──────────────────────────
drop function public.billing_attach_method(uuid, text, text, text, text, text, text);
create function public.billing_attach_method(
  p_business uuid, p_customer_key text, p_billing_key_enc text,
  p_card_company text, p_card_number_masked text, p_card_type text, p_billing_cycle text,
  p_consent_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub subscriptions%rowtype;
  v_old subscription_payment_methods%rowtype;
  v_new uuid;
begin
  if p_billing_cycle not in ('monthly', 'yearly') then raise exception 'invalid_cycle' using errcode = '22023'; end if;
  if coalesce(p_billing_key_enc, '') = '' then raise exception 'billing_key_required' using errcode = '22023'; end if;
  if coalesce(p_consent_version, '') !~ '^[A-Za-z0-9._-]{3,40}$' then raise exception 'consent_required' using errcode = '22023'; end if;
  select * into v_sub from subscriptions where business_id = p_business for update;
  if not found then raise exception 'subscription_not_found' using errcode = 'P0002'; end if;
  -- 이 매장에 발급한 customerKey 로 등록한 카드만 받는다 (다른 매장 카드 연결 방지)
  if v_sub.external_customer_id is null or v_sub.external_customer_id <> p_customer_key then
    raise exception 'customer_key_mismatch' using errcode = '42501';
  end if;
  select * into v_old from subscription_payment_methods where business_id = p_business and status = 'active' for update;
  if found then
    update subscription_payment_methods set status = 'replaced', replaced_at = now() where id = v_old.id;
  end if;
  insert into subscription_payment_methods (business_id, customer_key, billing_key_enc, card_company, card_number_masked, card_type)
  values (p_business, p_customer_key, p_billing_key_enc, p_card_company, p_card_number_masked, p_card_type)
  returning id into v_new;
  update subscriptions
    set payment_method_id = v_new, billing_cycle = p_billing_cycle, plan = coalesce(plan, 'standard'),
        auto_renew_consented_at = now(), auto_renew_consent_version = p_consent_version, updated_at = now()
  where id = v_sub.id;
  -- 교체된 이전 빌링키는 앱 서버가 토스에서 삭제한다
  return jsonb_build_object('method_id', v_new, 'replaced_billing_key_enc', v_old.billing_key_enc);
end;
$$;
revoke all on function public.billing_attach_method(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_attach_method(uuid, text, text, text, text, text, text, text) to service_role;

-- ── 직접 결제 시작 (012 정의 + 동의 기록, 동의 버전 필수) ─────────────────────
-- 결제 성공 시 active 로 돌아가 자동결제가 다시 이어지므로, 결제하기 화면에서 받은 동의를 여기서 기록한다.
drop function public.billing_start_manual(uuid, text);
create function public.billing_start_manual(p_business uuid, p_cycle text, p_consent_version text)
returns table (payment_id uuid, order_id text, order_name text, amount int, customer_key text, billing_key_enc text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_sub subscriptions%rowtype;
  v_price record;
  v_pid uuid;
begin
  if p_cycle not in ('monthly', 'yearly') then raise exception 'invalid_cycle' using errcode = '22023'; end if;
  if coalesce(p_consent_version, '') !~ '^[A-Za-z0-9._-]{3,40}$' then raise exception 'consent_required' using errcode = '22023'; end if;
  select * into v_sub from subscriptions where business_id = p_business for update;
  if not found then raise exception 'subscription_not_found' using errcode = 'P0002'; end if;
  -- 지금 이용 가능한 상태면 직접 결제를 받지 않는다 (중복 결제 방지)
  if public.business_is_writable(p_business) then raise exception 'already_active' using errcode = '23505'; end if;
  if v_sub.payment_method_id is null then raise exception 'payment_method_required' using errcode = '22023'; end if;
  if exists (select 1 from subscription_payments p where p.subscription_id = v_sub.id and p.status = 'pending') then
    raise exception 'payment_in_progress' using errcode = '23505';
  end if;
  select * into v_price from public.billing_price(p_cycle);
  insert into subscription_payments (business_id, subscription_id, payment_method_id, kind, billing_cycle, amount, supply_amount, vat_amount, order_id)
  values (p_business, v_sub.id, v_sub.payment_method_id, 'manual', p_cycle, v_price.amount, v_price.supply_amount, v_price.vat_amount,
          'mnsm_' || replace(gen_random_uuid()::text, '-', ''))
  returning id into v_pid;
  update subscriptions set auto_renew_consented_at = now(), auto_renew_consent_version = p_consent_version, updated_at = now()
  where id = v_sub.id;
  return query
    select p.id, p.order_id, v_price.order_name, p.amount, m.customer_key, m.billing_key_enc
    from subscription_payments p join subscription_payment_methods m on m.id = p.payment_method_id
    where p.id = v_pid;
end;
$$;
revoke all on function public.billing_start_manual(uuid, text, text) from public, anon, authenticated;
grant execute on function public.billing_start_manual(uuid, text, text) to service_role;

-- ── 자동결제 대상: 동의 기록이 있는 구독만 (012 정의 + 동의 조건) ──────────────
create or replace function public.billing_claim_due(p_limit int default 50)
returns table (payment_id uuid, business_id uuid, order_id text, order_name text, amount int, customer_key text, billing_key_enc text)
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
  -- 카드가 없거나 자동결제 동의 기록이 없는 체험은 종료 시 expired(trial_expired)
  update subscriptions set status = 'expired', expired_reason = 'trial_expired', updated_at = now()
  where status = 'trial' and (payment_method_id is null or auto_renew_consented_at is null) and trial_ends_at <= now();
  update trial_history set status = 'ended' where status = 'active' and trial_ends_at <= now();

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

  -- 새로 만든 것 + 이전 실행에서 결과를 확정하지 못한 pending 자동결제(같은 멱등키로 다시 확인)
  return query
    select p.id, p.business_id, p.order_id, (public.billing_price(p.billing_cycle)).order_name, p.amount, m.customer_key, m.billing_key_enc
    from subscription_payments p
    join subscription_payment_methods m on m.id = p.payment_method_id
    where p.status = 'pending' and p.kind = 'auto'
    order by p.requested_at
    limit p_limit;
end;
$$;

-- ── 체험 종료 처리: 동의 없는 카드는 카드 없는 체험과 같게 (013 정의 + 동의 조건) ──
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
end;
$$;

create or replace function public.expire_due_trials()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update subscriptions set status = 'expired', expired_reason = 'trial_expired', updated_at = now()
  where status = 'trial' and trial_ends_at <= now() and (payment_method_id is null or auto_renew_consented_at is null);
  get diagnostics v_n = row_count;
  update trial_history set status = 'ended' where status = 'active' and trial_ends_at <= now();
  return v_n;
end;
$$;

-- ROLLBACK (수동, 필요 시):
--   billing_attach_method / billing_start_manual 은 012 의 (동의 인자 없는) 정의로 drop 후 재생성,
--   billing_claim_due / expire_due_trials 는 012, sync_my_subscription 은 013 정의로 create or replace,
--   alter table public.subscriptions drop column auto_renew_consented_at, drop column auto_renew_consent_version;
