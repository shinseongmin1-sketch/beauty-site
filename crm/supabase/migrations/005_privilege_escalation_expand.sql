-- 005: 권한 상승 차단 (1/2) - 서버 함수 추가 (expand)
--
-- 배경: 기존 RLS 정책 `profiles_update_self` 때문에 로그인한 누구나 자기 프로필의
-- role / business_id 를 직접 바꿀 수 있었다 (다른 매장 UUID를 알면 그 매장의 대표가 될 수 있음).
--
-- 이 파일은 "추가만" 한다 (기존 동작을 깨지 않음). 새 함수를 먼저 만들고 앱 코드를 배포한 뒤,
-- 006_privilege_escalation_lockdown.sql 에서 직접 수정 권한을 회수한다 (expand → contract).
--
-- 되돌리기: drop function public.create_my_business(text,text,text);
--          drop function public.set_member_role(uuid, staff_role);
--          drop function public.current_staff_role();

-- 현재 로그인 사용자의 권한 등급 (RLS/함수 안에서 사용)
create or replace function public.current_staff_role()
returns staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;

-- 온보딩: 사업장 생성 + 내 프로필 연결 + 대표 직원 등록 + 기본 데이터를 한 트랜잭션으로 처리.
-- 클라이언트가 profiles.role / business_id 를 직접 쓰지 않도록 이 함수만 통과한다.
create or replace function public.create_my_business(
  p_name text,
  p_phone text default null,
  p_address text default null
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
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'name_required' using errcode = '22023';
  end if;

  -- 트리거가 만든 프로필이 없는 옛 계정 대비
  insert into profiles (id, full_name)
  select u.id, u.raw_user_meta_data ->> 'full_name'
  from auth.users u
  where u.id = v_uid
  on conflict (id) do nothing;

  select business_id, full_name into v_existing, v_full_name
  from profiles where id = v_uid for update;

  if v_existing is not null then
    raise exception 'business_already_exists' using errcode = '23505';
  end if;

  insert into businesses (owner_id, name, phone, address)
  values (v_uid, btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_address, '')), ''))
  returning id into v_business;

  update profiles set business_id = v_business, role = 'owner' where id = v_uid;

  insert into staff (business_id, profile_id, name, role)
  values (v_business, v_uid, coalesce(nullif(btrim(coalesce(v_full_name, '')), ''), '대표'), 'owner');

  insert into notification_settings (business_id) values (v_business);
  insert into payment_methods (business_id, name)
  values (v_business, '카드'), (v_business, '현금'), (v_business, '계좌이체');

  return v_business;
end;
$$;

-- 권한 변경: 대표(owner)만, 자기 사업장 소속 직원에 대해서만, owner 등급은 부여/변경 불가.
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
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select business_id, role into v_business, v_caller_role from profiles where id = v_uid;

  if v_business is null or v_caller_role is distinct from 'owner' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_role = 'owner' then
    raise exception 'cannot_assign_owner' using errcode = '42501';
  end if;

  select business_id, profile_id, role
    into v_target_business, v_target_profile, v_target_role
  from staff where id = p_staff_id;

  if not found or v_target_business is distinct from v_business then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_target_role = 'owner' then
    raise exception 'cannot_change_owner' using errcode = '42501';
  end if;

  update staff set role = p_role where id = p_staff_id;

  if v_target_profile is not null then
    update profiles set role = p_role where id = v_target_profile and business_id = v_business;
  end if;
end;
$$;

revoke all on function public.current_staff_role() from public, anon;
revoke all on function public.create_my_business(text, text, text) from public, anon;
revoke all on function public.set_member_role(uuid, staff_role) from public, anon;
grant execute on function public.current_staff_role() to authenticated;
grant execute on function public.create_my_business(text, text, text) to authenticated;
grant execute on function public.set_member_role(uuid, staff_role) to authenticated;
