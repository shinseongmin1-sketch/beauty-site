-- 018: 정기결제 결제수단에 "계좌 자동이체(토스 퀵계좌이체 자동결제)" 추가
--
-- 설계
--   - 결제수단 행에 종류(method: card | transfer)와 계좌 표시용 정보(은행명·마스킹된 계좌번호)를 추가한다.
--     기존 행은 모두 카드이므로 기본값 'card'.
--   - 빌링키로 결제하는 방식(POST /v1/billing/{billingKey})은 카드·계좌가 같다 → 결제/스케줄러 함수는 바꾸지 않는다.
--   - billing_attach_method 에 선택 인자(p_method, p_bank_name, p_account_number_masked)를 추가한다.
--     기본값이 카드라서, 기존 호출(인자 8개)은 그대로 동작한다.
--   - 계좌번호 원문은 받지 않는다 (토스가 돌려준 마스킹 번호만 저장).
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

alter table public.subscription_payment_methods
  add column method text not null default 'card' check (method in ('card', 'transfer')),
  add column bank_name text,
  add column account_number_masked text;

-- ── 결제수단 연결 (015 정의 + 결제수단 종류) ──────────────────────────────────
drop function public.billing_attach_method(uuid, text, text, text, text, text, text, text);
create function public.billing_attach_method(
  p_business uuid, p_customer_key text, p_billing_key_enc text,
  p_card_company text, p_card_number_masked text, p_card_type text, p_billing_cycle text,
  p_consent_version text,
  p_method text default 'card', p_bank_name text default null, p_account_number_masked text default null
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
  if coalesce(p_method, '') not in ('card', 'transfer') then raise exception 'invalid_method' using errcode = '22023'; end if;
  if coalesce(p_billing_key_enc, '') = '' then raise exception 'billing_key_required' using errcode = '22023'; end if;
  if coalesce(p_consent_version, '') !~ '^[A-Za-z0-9._-]{3,40}$' then raise exception 'consent_required' using errcode = '22023'; end if;
  select * into v_sub from subscriptions where business_id = p_business for update;
  if not found then raise exception 'subscription_not_found' using errcode = 'P0002'; end if;
  -- 이 매장에 발급한 customerKey 로 등록한 결제수단만 받는다 (다른 매장 결제수단 연결 방지)
  if v_sub.external_customer_id is null or v_sub.external_customer_id <> p_customer_key then
    raise exception 'customer_key_mismatch' using errcode = '42501';
  end if;
  select * into v_old from subscription_payment_methods where business_id = p_business and status = 'active' for update;
  if found then
    update subscription_payment_methods set status = 'replaced', replaced_at = now() where id = v_old.id;
  end if;
  insert into subscription_payment_methods
    (business_id, customer_key, billing_key_enc, method, card_company, card_number_masked, card_type, bank_name, account_number_masked)
  values
    (p_business, p_customer_key, p_billing_key_enc, p_method,
     case when p_method = 'card' then p_card_company end,
     case when p_method = 'card' then p_card_number_masked end,
     case when p_method = 'card' then p_card_type end,
     case when p_method = 'transfer' then p_bank_name end,
     case when p_method = 'transfer' then p_account_number_masked end)
  returning id into v_new;
  update subscriptions
    set payment_method_id = v_new, billing_cycle = p_billing_cycle, plan = coalesce(plan, 'standard'),
        auto_renew_consented_at = now(), auto_renew_consent_version = p_consent_version, updated_at = now()
  where id = v_sub.id;
  -- 교체된 이전 빌링키는 앱 서버가 토스에서 삭제한다
  return jsonb_build_object('method_id', v_new, 'replaced_billing_key_enc', v_old.billing_key_enc);
end;
$$;
revoke all on function public.billing_attach_method(uuid, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.billing_attach_method(uuid, text, text, text, text, text, text, text, text, text, text) to service_role;

-- ── 화면 표시용 결제수단 요약 (012 정의 + 종류·계좌 표시 정보). 빌링키/customerKey 는 돌려주지 않는다 ──
drop function public.billing_my_payment_method();
create function public.billing_my_payment_method()
returns table (method text, card_company text, card_number_masked text, card_type text, bank_name text, account_number_masked text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.method, m.card_company, m.card_number_masked, m.card_type, m.bank_name, m.account_number_masked, m.created_at
  from subscriptions s
  join subscription_payment_methods m on m.id = s.payment_method_id and m.status = 'active'
  where s.business_id = (select p.business_id from profiles p where p.id = auth.uid() and p.role = 'owner')
$$;
revoke all on function public.billing_my_payment_method() from public, anon;
grant execute on function public.billing_my_payment_method() to authenticated;

-- ROLLBACK (계좌 결제수단이 하나도 없을 때만):
--   drop function public.billing_my_payment_method();
--   → 012 의 billing_my_payment_method 정의 재생성
--   drop function public.billing_attach_method(uuid, text, text, text, text, text, text, text, text, text, text);
--   → 015 의 billing_attach_method(8 인자) 정의 재생성
--   alter table public.subscription_payment_methods drop column method, drop column bank_name, drop column account_number_masked;
