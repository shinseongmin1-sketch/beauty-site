-- 012: 매니온 구독 자동결제(토스 빌링) — 결제 실패 정책 (2026-09-30 확정)
--
-- 정책
--   - 유예기간·자동 재시도 없음. 결제일에 자동결제가 실패하면 즉시 expired(payment_failed) → 유료 기능(쓰기) 차단.
--   - 차단 중에도 로그인·조회·내보내기·결제수단 변경·직접 결제는 가능. 데이터는 삭제하지 않는다.
--   - 자동결제 성공: 시작 = 실제 결제 성공 시각(즉시 이용 가능), 종료 = 기존 종료 시각 + 1개월/12개월 (공백 없이 이어서 연장).
--   - 직접 결제 성공(차단 상태에서): 결제 성공 시각부터 새 이용기간 시작.
--   - 무료체험: 카드가 있으면 체험 종료일에 자동결제, 없으면 기존처럼 expired(trial_expired).
--   - 새 구독 상태값은 추가하지 않는다 (expired 재사용 + expired_reason 으로 사유 구분).
--
-- 보안
--   - 상태 전환(active/기간 변경)은 service_role 전용 함수로만 한다. 브라우저 권한(authenticated)은 subscriptions 에 쓰기 권한이 없고
--     아래 billing_* 전환 함수의 실행 권한도 없다 → 브라우저에서 status=active 를 보내 바꿀 방법이 없다.
--   - 결제 금액은 DB CHECK 로도 고정 (월간 10,000 / 연간 110,000, VAT 포함). 앱이 다른 금액으로 결제 기록을 만들 수 없다.
--   - 빌링키는 앱 서버가 AES-256-GCM 으로 암호화한 값만 저장한다 (평문 저장 금지). 결제수단 테이블은 브라우저 권한으로 조회 불가.
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

-- ── 구독: 만료 사유 + 현재 결제수단 ─────────────────────────────────────────
alter table public.subscriptions
  add column expired_reason text check (expired_reason in ('trial_expired', 'payment_failed', 'cancelled')),
  add column payment_method_id uuid,
  add column last_payment_at timestamptz;
-- 토스 customerKey 는 기존 external_customer_id 컬럼을 재사용한다 (매장당 1개, 추측 불가능한 무작위 값).
create unique index subscriptions_external_customer_id_idx on public.subscriptions (external_customer_id) where external_customer_id is not null;

-- 기존 체험 종료 행에 사유를 채운다 (체험 거부로 바로 expired 가 된 행도 "체험 없음/종료" 의미라 trial_expired).
update public.subscriptions set expired_reason = 'trial_expired' where status = 'expired' and expired_reason is null;

-- ── 결제수단 (service_role 전용) ──────────────────────────────────────────
create table public.subscription_payment_methods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null default 'toss' check (provider = 'toss'),
  customer_key text not null,
  billing_key_enc text not null,               -- 앱 서버가 암호화한 빌링키 (평문 저장 금지)
  card_company text,
  card_number_masked text,                     -- 토스가 돌려준 마스킹 번호만 저장 (카드번호/CVC 는 우리 쪽으로 오지 않는다)
  card_type text,
  status text not null default 'active' check (status in ('active', 'replaced', 'deleted')),
  created_at timestamptz not null default now(),
  replaced_at timestamptz
);
create unique index subscription_payment_methods_one_active on public.subscription_payment_methods (business_id) where status = 'active';
alter table public.subscription_payment_methods enable row level security;
revoke all on public.subscription_payment_methods from anon, authenticated;

alter table public.subscriptions
  add constraint subscriptions_payment_method_fk foreign key (payment_method_id)
  references public.subscription_payment_methods(id) on delete set null;

-- ── 구독 결제 기록 (예약 결제용 payments 테이블과 분리) ─────────────────────
create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  payment_method_id uuid references public.subscription_payment_methods(id) on delete set null,
  kind text not null check (kind in ('auto', 'manual')),
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  amount int not null,
  supply_amount int not null,
  vat_amount int not null,
  due_at timestamptz,                          -- 자동결제: 갱신 대상 기간의 종료 시각(=다음 기간 시작)
  order_id text not null unique,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  toss_payment_key text,
  failure_code text,
  failure_message text,
  period_start timestamptz,
  period_end timestamptz,
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  -- 가격은 서버/DB 기준 고정값만 허용 (VAT 포함)
  check (
    (billing_cycle = 'monthly' and amount = 10000 and supply_amount = 9091 and vat_amount = 909)
    or (billing_cycle = 'yearly' and amount = 110000 and supply_amount = 100000 and vat_amount = 10000)
  ),
  check (kind = 'manual' or due_at is not null)
);
-- 같은 구독에 진행 중(pending) 결제는 1건만, 같은 갱신 기간(due_at)의 자동결제는 1번만
create unique index subscription_payments_one_pending on public.subscription_payments (subscription_id) where status = 'pending';
create unique index subscription_payments_auto_once on public.subscription_payments (subscription_id, due_at) where kind = 'auto';
create index subscription_payments_business_idx on public.subscription_payments (business_id, created_at desc);
alter table public.subscription_payments enable row level security;
revoke all on public.subscription_payments from anon, authenticated;
-- 대표만 자기 매장 결제 내역을 조회 (결제키/실패 원문 등은 열 단위로 제외)
grant select (id, business_id, kind, billing_cycle, amount, supply_amount, vat_amount, status, failure_code,
              period_start, period_end, requested_at, paid_at, failed_at) on public.subscription_payments to authenticated;
create policy subscription_payments_owner_select on public.subscription_payments
  for select to authenticated
  using (business_id = public.current_business_id()
         and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'owner'));

-- ── 가격 (DB 기준값. 앱 lib/billing/plans.ts 와 같아야 하며 CHECK 로도 고정) ─────
create or replace function public.billing_price(p_cycle text, out amount int, out supply_amount int, out vat_amount int, out period interval, out order_name text)
language sql
immutable
as $$
  select v.a, v.s, v.t, v.p, v.n from (values
    ('monthly', 10000, 9091, 909, interval '1 month', '매니온 월간 이용권'),
    ('yearly', 110000, 100000, 10000, interval '1 year', '매니온 연간 이용권')
  ) v(c, a, s, t, p, n) where v.c = p_cycle
$$;
revoke all on function public.billing_price(text) from public, anon, authenticated;

-- ── 쓰기 가능 여부: active 는 "이용기간 안"일 때만 ─────────────────────────
create or replace function public.business_is_writable(p_business uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from subscriptions s
    where s.business_id = p_business
      and (
        (s.status = 'active' and s.current_period_start is not null and s.current_period_end is not null
           and s.current_period_start <= now() and now() < s.current_period_end)
        or (s.status = 'trial' and s.trial_ends_at > now())
        or (s.status = 'canceled' and s.current_period_end is not null and s.current_period_end > now())
      )
  )
$$;

-- ── 체험 종료 처리: 카드가 등록된 체험은 여기서 끝내지 않는다 (자동결제가 처리) ─────
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
  where business_id = v_business and status = 'trial' and trial_ends_at <= now() and payment_method_id is null;
  update trial_history set status = 'ended'
  where business_id = v_business and status = 'active' and trial_ends_at <= now();
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
  where status = 'trial' and trial_ends_at <= now() and payment_method_id is null;
  get diagnostics v_n = row_count;
  update trial_history set status = 'ended' where status = 'active' and trial_ends_at <= now();
  return v_n;
end;
$$;

-- ── 토스 customerKey (대표 본인만, 매장당 1개 생성) ────────────────────────
create or replace function public.billing_customer_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_role staff_role;
  v_key text;
begin
  select business_id, role into v_business, v_role from profiles where id = auth.uid();
  if v_business is null or v_role is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  select external_customer_id into v_key from subscriptions where business_id = v_business for update;
  if not found then raise exception 'subscription_not_found' using errcode = 'P0002'; end if;
  if v_key is null then
    v_key := 'mn_' || replace(gen_random_uuid()::text, '-', '');   -- 35자, 토스 규칙(영숫자+특수문자, 2~50자) 충족
    update subscriptions set external_customer_id = v_key, updated_at = now() where business_id = v_business;
  end if;
  return v_key;
end;
$$;
revoke all on function public.billing_customer_key() from public, anon;
grant execute on function public.billing_customer_key() to authenticated;

-- 화면 표시용 결제수단 요약 (빌링키/customerKey 는 돌려주지 않는다)
create or replace function public.billing_my_payment_method()
returns table (card_company text, card_number_masked text, card_type text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.card_company, m.card_number_masked, m.card_type, m.created_at
  from subscriptions s
  join subscription_payment_methods m on m.id = s.payment_method_id and m.status = 'active'
  where s.business_id = (select p.business_id from profiles p where p.id = auth.uid() and p.role = 'owner')
$$;
revoke all on function public.billing_my_payment_method() from public, anon;
grant execute on function public.billing_my_payment_method() to authenticated;

-- ── 결제수단 연결 (service_role: 토스 빌링키 발급 성공 후 앱 서버가 호출) ──────────
create or replace function public.billing_attach_method(
  p_business uuid, p_customer_key text, p_billing_key_enc text,
  p_card_company text, p_card_number_masked text, p_card_type text, p_billing_cycle text
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
  update subscriptions set payment_method_id = v_new, billing_cycle = p_billing_cycle, plan = coalesce(plan, 'standard'), updated_at = now()
  where id = v_sub.id;
  -- 교체된 이전 빌링키는 앱 서버가 토스에서 삭제한다
  return jsonb_build_object('method_id', v_new, 'replaced_billing_key_enc', v_old.billing_key_enc);
end;
$$;
revoke all on function public.billing_attach_method(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_attach_method(uuid, text, text, text, text, text, text) to service_role;

-- ── 자동결제 대상 확보 (service_role: 스케줄러가 하루 1번 호출) ──────────────────
-- 결제일 = 이용기간(또는 체험) 종료 시각의 한국 날짜. 그 날짜가 오늘 이전/오늘이면 1회 결제를 시도한다.
-- 성공하면 이전 종료 시각부터 이어서 연장되므로 이용이 끊기지 않고, 실패하면 결제일에 즉시 차단된다.
-- 카드가 없는 체험은 여기서 expired(trial_expired) 로 정리한다.
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
  update subscriptions set status = 'expired', expired_reason = 'trial_expired', updated_at = now()
  where status = 'trial' and payment_method_id is null and trial_ends_at <= now();
  update trial_history set status = 'ended' where status = 'active' and trial_ends_at <= now();

  for r in
    select s.id, s.business_id, s.billing_cycle, s.payment_method_id,
           case when s.status = 'trial' then s.trial_ends_at else s.current_period_end end as due_at
    from subscriptions s
    join subscription_payment_methods m on m.id = s.payment_method_id and m.status = 'active'
    where s.billing_cycle is not null
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
revoke all on function public.billing_claim_due(int) from public, anon, authenticated;
grant execute on function public.billing_claim_due(int) to service_role;

-- ── 직접 결제 시작 (service_role: 차단 상태의 대표가 결제하기를 누르면 앱 서버가 호출) ──
create or replace function public.billing_start_manual(p_business uuid, p_cycle text)
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
  return query
    select p.id, p.order_id, v_price.order_name, p.amount, m.customer_key, m.billing_key_enc
    from subscription_payments p join subscription_payment_methods m on m.id = p.payment_method_id
    where p.id = v_pid;
end;
$$;
revoke all on function public.billing_start_manual(uuid, text) from public, anon, authenticated;
grant execute on function public.billing_start_manual(uuid, text) to service_role;

-- ── 결제 결과 반영 (service_role: 토스 응답을 서버에서 검증한 뒤에만 호출) ─────────
-- 성공: 시작은 항상 결제 성공 시각. 종료는 자동결제 → 기존 종료 시각 + 기간 / 직접 결제 → 결제 성공 시각 + 기간. 이미 확정된 결제면 아무것도 바꾸지 않는다(멱등).
-- 실패: 자동결제 → 즉시 expired(payment_failed). 직접 결제 실패는 상태를 바꾸지 않는다(이미 차단 상태).
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
begin
  select * into v_pay from subscription_payments where id = p_payment_id for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if v_pay.status <> 'pending' then
    return jsonb_build_object('status', v_pay.status, 'already_recorded', true);
  end if;
  select * into v_sub from subscriptions where id = v_pay.subscription_id for update;

  if p_success then
    if coalesce(p_toss_payment_key, '') = '' then raise exception 'payment_key_required' using errcode = '22023'; end if;
    -- 시작 = 실제 결제 성공 시각 (자동결제·직접 결제 모두). 결제 성공 즉시 쓰기 가능하고, 결제일 새벽에 미리 결제돼도 공백이 없다.
    -- 종료 = 자동결제: 기존 종료 시각(due_at) + 1개월/12개월 (기존 기간의 남은 시간을 버리지 않고 이어서 연장)
    --        직접 결제: 결제 성공 시각 + 1개월/12개월
    v_start := coalesce(p_approved_at, now());
    v_end := (case when v_pay.kind = 'auto' then v_pay.due_at else v_start end) + (public.billing_price(v_pay.billing_cycle)).period;
    update subscription_payments
      set status = 'paid', toss_payment_key = p_toss_payment_key, paid_at = coalesce(p_approved_at, now()),
          period_start = v_start, period_end = v_end
      where id = v_pay.id;
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
  if v_pay.kind = 'auto' then
    update subscriptions set status = 'expired', expired_reason = 'payment_failed', updated_at = now() where id = v_sub.id;
    update trial_history set status = 'ended' where business_id = v_sub.business_id and status = 'active';
  end if;
  return jsonb_build_object('status', 'failed');
end;
$$;
revoke all on function public.billing_record_result(uuid, boolean, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.billing_record_result(uuid, boolean, text, timestamptz, text, text) to service_role;

-- ROLLBACK (수동, 필요 시):
--   drop function public.billing_record_result(uuid, boolean, text, timestamptz, text, text);
--   drop function public.billing_start_manual(uuid, text);
--   drop function public.billing_claim_due(int);
--   drop function public.billing_attach_method(uuid, text, text, text, text, text, text);
--   drop function public.billing_my_payment_method();
--   drop function public.billing_customer_key();
--   drop function public.billing_price(text);
--   -- business_is_writable / sync_my_subscription / expire_due_trials 는 009 의 정의로 다시 create or replace
--   alter table public.subscriptions drop constraint subscriptions_payment_method_fk;
--   drop table public.subscription_payments; drop table public.subscription_payment_methods;
--   drop index public.subscriptions_external_customer_id_idx;
--   alter table public.subscriptions drop column expired_reason, drop column payment_method_id, drop column last_payment_at;
