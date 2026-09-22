-- 009: 무료체험 + 구독 구조
--
-- 정책
--   - 사업장당 최초 1회 3개월 무료체험. 사업자등록번호가 1순위 중복 방지 기준, 전화번호는 보조 신호.
--   - 사업자등록번호 "원문"은 DB 에 저장하지 않는다. 서버가 비밀값(pepper)으로 만든 HMAC 해시(중복 확인용)와
--     마스킹 표기(화면 표시용)만 저장한다. 해시 계산은 앱 서버(lib/business-number.ts)에서만 한다.
--   - 무료체험 이력(trial_history)은 사업장/계정 삭제와 무관하게 남는다 (business_id 는 on delete set null).
--   - 체험 종료 후에도 로그인·조회·내보내기는 허용, 등록/수정/삭제는 DB(RLS)에서 차단한다.
--   - 결제는 아직 연결하지 않는다: 'active' 로 바꾸는 코드는 없고, 나중에 결제 웹훅(service_role)이 채울 자리만 만든다.
--
-- 007/008 의 직급별 권한 정책은 그대로 두고, "구독이 쓰기 가능한 상태인가"를 RESTRICTIVE 정책으로 덧씌운다
-- (RESTRICTIVE 는 기존 PERMISSIVE 정책과 AND 로 결합 → 직급 권한 체계와 충돌하지 않음).
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

create type public.subscription_status as enum ('trial', 'active', 'expired', 'canceled', 'suspended');

-- ── 운영 설정값 (service_role 전용) ───────────────────────────────────────
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
insert into public.platform_settings (key, value) values
  ('trial_months', '3'::jsonb),                       -- 무료체험 기간(개월)
  ('trial_phone_limit', '3'::jsonb),                  -- 같은 전화번호(해시)로 지급 가능한 최대 체험 수 (보조 신호)
  ('trial_history_retention_months', 'null'::jsonb);  -- 식별정보 보관기간: 법률 검토 후 확정 (null = 미확정)

create or replace function public.platform_setting_int(p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::int from platform_settings where key = p_key and jsonb_typeof(value) = 'number'), p_default)
$$;
revoke all on function public.platform_setting_int(text, int) from public, anon, authenticated;

-- ── 사업장 정보 컬럼 ────────────────────────────────────────────────────
alter table public.businesses
  add column representative_name text,
  add column business_number_hash text,
  add column business_number_masked text,
  add column identifier_hash_version smallint;
create index businesses_business_number_hash_idx on public.businesses (business_number_hash) where business_number_hash is not null;
-- 대표자명은 대표가 수정 가능. 사업자번호(해시/마스킹)는 아래 함수로만 설정한다.
grant update (representative_name) on public.businesses to authenticated;

-- ── 구독 ──────────────────────────────────────────────────────────────
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  status public.subscription_status not null,
  plan text,
  billing_cycle text check (billing_cycle in ('monthly', 'yearly')),
  trial_source text check (trial_source in ('signup', 'legacy_backfill')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_denied_reason text,                 -- 'business_number_used' | 'phone_limit'
  current_period_start timestamptz,         -- 이하 결제 연동 시 사용할 자리
  current_period_end timestamptz,
  canceled_at timestamptz,
  suspended_at timestamptz,
  suspended_reason text,
  external_customer_id text,
  external_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'trial' or (trial_started_at is not null and trial_ends_at is not null))
);
alter table public.subscriptions enable row level security;
revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;
create policy subscriptions_select on public.subscriptions
  for select to authenticated using (business_id = public.current_business_id());

-- ── 무료체험 이력 (사업장/계정 삭제와 무관하게 유지) ─────────────────────
create table public.trial_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete set null,
  business_number_hash text unique,         -- 1순위 기준. 같은 번호로는 체험이 한 번만 지급된다 (DB 유니크로 보장)
  phone_hash text,                          -- 보조 신호
  phone_seen_before boolean not null default false,
  hash_version smallint not null default 1, -- pepper 교체 대비
  source text not null default 'signup' check (source in ('signup', 'legacy_backfill')),
  trial_started_at timestamptz not null,
  trial_ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  retain_until timestamptz,                 -- 보관 만료일: 정책 확정 전에는 null
  created_at timestamptz not null default now()
);
create index trial_history_phone_hash_idx on public.trial_history (phone_hash) where phone_hash is not null;
create index trial_history_business_idx on public.trial_history (business_id);
alter table public.trial_history enable row level security;
revoke all on public.trial_history from anon, authenticated;   -- 브라우저 권한으로는 존재 자체를 볼 수 없다 (service_role 전용)

-- ── 쓰기 가능 여부 (DB 가 유일한 기준) ───────────────────────────────────
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
        s.status = 'active'
        or (s.status = 'trial' and s.trial_ends_at > now())
        or (s.status = 'canceled' and s.current_period_end is not null and s.current_period_end > now())
      )
  )
$$;
revoke all on function public.business_is_writable(uuid) from public, anon;
grant execute on function public.business_is_writable(uuid) to authenticated;

create or replace function public.assert_business_writable(p_business uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.business_is_writable(p_business) then
    raise exception 'subscription_inactive' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.assert_business_writable(uuid) from public, anon, authenticated;

-- 쓰기 차단: 기존(직급) 정책과 AND 로 결합되는 RESTRICTIVE 정책. SELECT 는 건드리지 않는다 (조회·내보내기 허용).
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers','reservations','consultations','payments','payment_methods','services',
    'reservation_groups','reservation_types','consultation_types','customer_grades','customer_tags',
    'customer_tag_links','staff','notification_settings','marketing_messages'
  ] loop
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (public.business_is_writable(business_id))', t || '_sub_insert', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (public.business_is_writable(business_id)) with check (public.business_is_writable(business_id))', t || '_sub_update', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (public.business_is_writable(business_id))', t || '_sub_delete', t);
  end loop;
end $$;

-- 사업장 정보(매장 설정) 수정 차단
create policy businesses_sub_update on public.businesses
  as restrictive for update to authenticated
  using (public.business_is_writable(id)) with check (public.business_is_writable(id));

-- ── 사업장 생성 + 무료체험 지급 (유일한 관문) ────────────────────────────
drop function public.create_my_business(text, text, text);

create or replace function public.create_my_business(
  p_name text,
  p_phone text default null,
  p_address text default null,
  p_representative_name text default null,
  p_business_number_hash text default null,
  p_business_number_masked text default null,
  p_phone_hash text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_existing uuid;
  v_full_name text;
  v_business uuid;
  v_months int := public.platform_setting_int('trial_months', 3);
  v_phone_limit int := public.platform_setting_int('trial_phone_limit', 3);
  v_grant boolean := true;
  v_reason text;
  v_history uuid;
  v_phone_seen boolean := false;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'name_required' using errcode = '22023'; end if;

  insert into profiles (id, full_name)
  select u.id, u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = v_uid
  on conflict (id) do nothing;

  select business_id, full_name into v_existing, v_full_name from profiles where id = v_uid for update;
  if v_existing is not null then raise exception 'business_already_exists' using errcode = '23505'; end if;

  if coalesce(p_business_number_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'business_number_required' using errcode = '22023';
  end if;
  if p_phone_hash is not null and p_phone_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_phone_hash' using errcode = '22023';
  end if;

  insert into businesses (owner_id, name, phone, address, representative_name,
                          business_number_hash, business_number_masked, identifier_hash_version)
  values (v_uid, btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_address, '')), ''),
          nullif(btrim(coalesce(p_representative_name, '')), ''), p_business_number_hash, p_business_number_masked, 1)
  returning id into v_business;

  update profiles set business_id = v_business, role = 'owner' where id = v_uid;

  insert into staff (business_id, profile_id, name, role)
  values (v_business, v_uid, coalesce(nullif(btrim(coalesce(v_full_name, '')), ''), '대표'), 'owner');

  insert into notification_settings (business_id) values (v_business);
  insert into payment_methods (business_id, name)
  values (v_business, '카드'), (v_business, '현금'), (v_business, '계좌이체');

  -- ── 무료체험 지급 판단 ──
  if exists (select 1 from trial_history where business_number_hash = p_business_number_hash) then
    v_grant := false; v_reason := 'business_number_used';
  elsif p_phone_hash is not null then
    v_phone_seen := exists (select 1 from trial_history where phone_hash = p_phone_hash);
    if (select count(*) from trial_history where phone_hash = p_phone_hash) >= v_phone_limit then
      v_grant := false; v_reason := 'phone_limit';
    end if;
  end if;

  if v_grant then
    -- 동시 가입이 같은 번호로 몰려도 유니크 제약이 한 건만 통과시킨다
    insert into trial_history (business_id, business_number_hash, phone_hash, phone_seen_before, source, trial_started_at, trial_ends_at)
    values (v_business, p_business_number_hash, p_phone_hash, v_phone_seen, 'signup', now(), now() + make_interval(months => v_months))
    on conflict (business_number_hash) do nothing
    returning id into v_history;
    if v_history is null then v_grant := false; v_reason := 'business_number_used'; end if;
  end if;

  if v_grant then
    insert into subscriptions (business_id, status, trial_source, trial_started_at, trial_ends_at)
    values (v_business, 'trial', 'signup', now(), now() + make_interval(months => v_months));
  else
    insert into subscriptions (business_id, status, trial_denied_reason)
    values (v_business, 'expired', v_reason);
  end if;

  return v_business;
end;
$$;
revoke all on function public.create_my_business(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_my_business(text, text, text, text, text, text, text) to authenticated;

-- ── 기존 사업장이 사업자번호를 나중에 등록 (대표 전용, 1회) ─────────────────
create or replace function public.set_business_number(p_hash text, p_masked text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_business uuid;
  v_role staff_role;
  v_current text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select business_id, role into v_business, v_role from profiles where id = v_uid;
  if v_business is null or v_role is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'business_number_required' using errcode = '22023'; end if;

  select business_number_hash into v_current from businesses where id = v_business for update;
  if v_current is not null then raise exception 'business_number_already_set' using errcode = '23505'; end if;

  begin
    update trial_history set business_number_hash = p_hash where business_id = v_business and business_number_hash is null;
  exception when unique_violation then
    raise exception 'business_number_in_use' using errcode = '23505';
  end;

  update businesses set business_number_hash = p_hash, business_number_masked = p_masked, identifier_hash_version = 1 where id = v_business;
end;
$$;
revoke all on function public.set_business_number(text, text) from public, anon;
grant execute on function public.set_business_number(text, text) to authenticated;

-- ── 체험 만료 반영 (조회 시점에도 DB 시각 기준으로 판단, 여기서는 저장값만 맞춘다) ──
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
  update subscriptions set status = 'expired', updated_at = now()
  where business_id = v_business and status = 'trial' and trial_ends_at <= now();
  update trial_history set status = 'ended'
  where business_id = v_business and status = 'active' and trial_ends_at <= now();
end;
$$;
revoke all on function public.sync_my_subscription() from public, anon;
grant execute on function public.sync_my_subscription() to authenticated;

-- 전체 사업장 일괄 만료 반영 (나중에 스케줄러/관리자 페이지에서 사용, service_role 전용)
create or replace function public.expire_due_trials()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update subscriptions set status = 'expired', updated_at = now() where status = 'trial' and trial_ends_at <= now();
  get diagnostics v_n = row_count;
  update trial_history set status = 'ended' where status = 'active' and trial_ends_at <= now();
  return v_n;
end;
$$;
revoke all on function public.expire_due_trials() from public, anon, authenticated;
grant execute on function public.expire_due_trials() to service_role;

-- ── 기존 함수에 구독 검사 추가 (초대 생성 / 직급 변경은 "쓰기" 이므로 차단. 취소·해제는 보안 조치라 허용) ──
create or replace function public.set_member_role(p_staff_id uuid, p_role staff_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_business uuid;
  v_caller_role staff_role;
  v_target_business uuid;
  v_target_profile uuid;
  v_target_role staff_role;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select business_id, role into v_business, v_caller_role from profiles where id = v_uid;
  if v_business is null or v_caller_role is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.assert_business_writable(v_business);

  if p_role = 'owner' then raise exception 'cannot_assign_owner' using errcode = '42501'; end if;

  select business_id, profile_id, role into v_target_business, v_target_profile, v_target_role
  from staff where id = p_staff_id;
  if not found or v_target_business is distinct from v_business then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_target_role = 'owner' then raise exception 'cannot_change_owner' using errcode = '42501'; end if;

  update staff set role = p_role where id = p_staff_id;
  if v_target_profile is not null then
    update profiles set role = p_role where id = v_target_profile and business_id = v_business;
  end if;
end;
$$;

create or replace function public.create_staff_invitation(p_staff_id uuid, p_email text, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_business uuid;
  v_caller_role staff_role;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_target_business uuid;
  v_target_profile uuid;
  v_target_role staff_role;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select business_id, role into v_business, v_caller_role from profiles where id = v_uid;
  if v_business is null or v_caller_role not in ('owner', 'manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.assert_business_writable(v_business);

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then
    raise exception 'invalid_email' using errcode = '22023';
  end if;
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  select business_id, profile_id, role into v_target_business, v_target_profile, v_target_role
  from staff where id = p_staff_id;
  if not found or v_target_business is distinct from v_business then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_target_role = 'owner' then raise exception 'cannot_invite_owner' using errcode = '42501'; end if;
  if v_target_profile is not null then raise exception 'already_linked' using errcode = '23505'; end if;
  if v_caller_role = 'manager' and v_target_role <> 'staff' then
    raise exception 'manager_can_invite_staff_only' using errcode = '42501';
  end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'email_taken' using errcode = '23505';
  end if;
  if exists (
    select 1 from staff_invitations i
    where lower(i.email) = v_email and i.staff_id <> p_staff_id
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
  ) then
    raise exception 'email_pending' using errcode = '23505';
  end if;

  update staff_invitations set revoked_at = now()
  where staff_id = p_staff_id and accepted_at is null and revoked_at is null;

  insert into staff_invitations (business_id, staff_id, email, role, token_hash, invited_by, expires_at)
  values (v_business, p_staff_id, v_email, v_target_role, p_token_hash, v_uid, now() + interval '7 days')
  returning id into v_id;

  return v_id;
end;
$$;

-- ── 기존 사업장 백필: 출시(적용) 시점부터 3개월 무료체험 (기존 사용자를 갑자기 막지 않기 위함) ──
insert into public.subscriptions (business_id, status, trial_source, trial_started_at, trial_ends_at)
select b.id, 'trial', 'legacy_backfill', now(), now() + make_interval(months => public.platform_setting_int('trial_months', 3))
from public.businesses b
where not exists (select 1 from public.subscriptions s where s.business_id = b.id);

-- 사업자번호를 아직 모르는 기존 사업장의 이력 행 (번호는 나중에 대표가 등록하면 채워진다)
insert into public.trial_history (business_id, source, trial_started_at, trial_ends_at)
select s.business_id, 'legacy_backfill', s.trial_started_at, s.trial_ends_at
from public.subscriptions s
where s.trial_source = 'legacy_backfill'
  and not exists (select 1 from public.trial_history h where h.business_id = s.business_id);

-- ROLLBACK (필요 시 수동 실행, 역순):
--   drop policy businesses_sub_update on public.businesses;
--   do $r$ declare t text; begin foreach t in array array['customers','reservations','consultations','payments','payment_methods','services',
--     'reservation_groups','reservation_types','consultation_types','customer_grades','customer_tags','customer_tag_links','staff',
--     'notification_settings','marketing_messages'] loop
--       execute format('drop policy %I on public.%I', t||'_sub_insert', t); execute format('drop policy %I on public.%I', t||'_sub_update', t);
--       execute format('drop policy %I on public.%I', t||'_sub_delete', t); end loop; end $r$;
--   (create_my_business 는 005 의 3인자 버전으로, set_member_role/create_staff_invitation 은 005/008 의 원본 정의로 복원)
--   drop function public.expire_due_trials(), public.sync_my_subscription(), public.set_business_number(text, text),
--     public.assert_business_writable(uuid), public.business_is_writable(uuid), public.platform_setting_int(text, int);
--   drop table public.trial_history, public.subscriptions, public.platform_settings;
--   alter table public.businesses drop column representative_name, drop column business_number_hash,
--     drop column business_number_masked, drop column identifier_hash_version;
--   drop type public.subscription_status;
