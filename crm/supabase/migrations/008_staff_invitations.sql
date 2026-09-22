-- 008: 직원 로그인 계정 초대 / 연결 / 해제 (F2)
--
-- 흐름
--   1) 대표/관리자가 담당자(staff) 행을 골라 이메일을 입력 → 서버가 일회용 토큰을 만들고 "해시"만 DB 에 저장,
--      원본 토큰은 초대 링크(/invite/<token>)로 대표/관리자에게만 한 번 보여준다.
--   2) 초대받은 사람이 링크에서 이름·비밀번호를 설정 → 서버(service_role)가 계정을 만들고
--      finalize_staff_invitation() 으로 프로필(사업장/직급)과 담당자(staff.profile_id)를 연결한다.
--   3) 연결 해제는 unlink_staff_account() (계정의 사업장 접근 제거) — 서버가 초대용 계정을 함께 삭제한다.
--
-- 보안
--   - 토큰 원본은 저장하지 않는다 (sha256 해시만). 7일 만료, 1회용, 취소 가능.
--   - 초대는 초대한 사업장/직급/이메일에 고정된다. 초대받은 사람은 그 외 사업장에 접근할 수 없다.
--   - 생성·취소·해제는 owner/manager 만 (관리자는 "직원" 직급 담당자만 초대/해제 가능, 관리자 직급은 대표만).
--   - 수락(lookup/finalize)은 service_role 전용 함수: 브라우저(anon/authenticated)에서 직접 호출 불가.
--   - 연결된 담당자 행은 DELETE 로 지울 수 없다 (계정에 사업장 접근 권한이 남는 것을 막음) → 반드시 해제 함수를 쓴다.
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

create table public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  email text not null,
  role staff_role not null check (role in ('manager', 'staff')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references profiles(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_profile_id uuid references profiles(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index staff_invitations_staff_idx on public.staff_invitations (staff_id);
create index staff_invitations_email_idx on public.staff_invitations (lower(email));

alter table public.staff_invitations enable row level security;
revoke all on public.staff_invitations from anon, authenticated;
-- token_hash 는 조회 대상 컬럼에서 제외 (대표/관리자도 볼 수 없음). 쓰기는 아래 함수로만.
grant select (id, business_id, staff_id, email, role, expires_at, accepted_at, revoked_at, created_at, invited_by)
  on public.staff_invitations to authenticated;
create policy staff_invitations_select on public.staff_invitations
  for select to authenticated
  using (business_id = public.current_business_id() and public.has_role(array['owner','manager']::staff_role[]));

-- 연결된(로그인 계정이 있는) 담당자 행은 삭제 불가: 007 의 삭제 정책을 교체
drop policy if exists staff_delete on public.staff;
create policy staff_delete on public.staff
  for delete to authenticated
  using (
    business_id = public.current_business_id()
    and public.has_role(array['owner','manager']::staff_role[])
    and role <> 'owner'
    and profile_id is null
  );

-- ── 초대 생성 ───────────────────────────────────────────────────────────
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

  -- 같은 담당자의 이전 대기 초대는 무효화 (재발급)
  update staff_invitations set revoked_at = now()
  where staff_id = p_staff_id and accepted_at is null and revoked_at is null;

  insert into staff_invitations (business_id, staff_id, email, role, token_hash, invited_by, expires_at)
  values (v_business, p_staff_id, v_email, v_target_role, p_token_hash, v_uid, now() + interval '7 days')
  returning id into v_id;

  return v_id;
end;
$$;

-- ── 초대 취소 ───────────────────────────────────────────────────────────
create or replace function public.revoke_staff_invitation(p_staff_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_business uuid;
  v_caller_role staff_role;
  v_target_business uuid;
  v_target_role staff_role;
  v_n integer;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select business_id, role into v_business, v_caller_role from profiles where id = v_uid;
  if v_business is null or v_caller_role not in ('owner', 'manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select business_id, role into v_target_business, v_target_role from staff where id = p_staff_id;
  if not found or v_target_business is distinct from v_business then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_caller_role = 'manager' and v_target_role <> 'staff' then
    raise exception 'manager_can_invite_staff_only' using errcode = '42501';
  end if;

  update staff_invitations set revoked_at = now()
  where staff_id = p_staff_id and accepted_at is null and revoked_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── 계정 연결 해제 ──────────────────────────────────────────────────────
-- 프로필의 사업장 접근을 제거하고 담당자 행과의 연결을 끊는다. 반환값(프로필 id)으로 서버가 로그인 계정을 삭제한다.
create or replace function public.unlink_staff_account(p_staff_id uuid)
returns uuid
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
  if v_business is null or v_caller_role not in ('owner', 'manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select business_id, profile_id, role into v_target_business, v_target_profile, v_target_role
  from staff where id = p_staff_id;
  if not found or v_target_business is distinct from v_business then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_target_role = 'owner' or v_target_profile = v_uid then
    raise exception 'cannot_unlink_owner_or_self' using errcode = '42501';
  end if;
  if v_target_profile is null then raise exception 'not_linked' using errcode = 'P0002'; end if;
  if v_caller_role = 'manager' and v_target_role <> 'staff' then
    raise exception 'manager_can_invite_staff_only' using errcode = '42501';
  end if;

  update profiles set business_id = null, role = 'staff'
  where id = v_target_profile and business_id = v_business;
  update staff set profile_id = null where id = p_staff_id;
  update staff_invitations set revoked_at = now()
  where staff_id = p_staff_id and accepted_at is null and revoked_at is null;

  return v_target_profile;
end;
$$;

-- ── 초대 수락 (서버 전용: service_role) ─────────────────────────────────
create or replace function public.lookup_staff_invitation(p_token_hash text)
returns table (business_name text, email text, role staff_role, staff_name text)
language sql
stable
security definer
set search_path = public
as $$
  select b.name, i.email, i.role, s.name
  from staff_invitations i
  join businesses b on b.id = i.business_id
  join staff s on s.id = i.staff_id
  where i.token_hash = p_token_hash
    and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    and s.profile_id is null
$$;

create or replace function public.finalize_staff_invitation(p_token_hash text, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv staff_invitations%rowtype;
  v_email text;
begin
  select * into v_inv from staff_invitations
  where token_hash = p_token_hash and accepted_at is null and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception 'invalid_or_expired_invitation' using errcode = 'P0002'; end if;

  -- 초대된 이메일과 실제 생성된 계정의 이메일이 같아야 한다
  select lower(email) into v_email from auth.users where id = p_user_id;
  if v_email is distinct from lower(v_inv.email) then
    raise exception 'email_mismatch' using errcode = '42501';
  end if;

  insert into profiles (id, full_name)
  select u.id, u.raw_user_meta_data ->> 'full_name' from auth.users u where u.id = p_user_id
  on conflict (id) do nothing;

  if exists (select 1 from profiles where id = p_user_id and business_id is not null) then
    raise exception 'account_already_belongs_to_business' using errcode = '23505';
  end if;

  update staff set profile_id = p_user_id
  where id = v_inv.staff_id and business_id = v_inv.business_id and profile_id is null;
  if not found then raise exception 'staff_already_linked' using errcode = '23505'; end if;

  update profiles set business_id = v_inv.business_id, role = v_inv.role where id = p_user_id;
  update staff_invitations set accepted_at = now(), accepted_profile_id = p_user_id where id = v_inv.id;

  return v_inv.staff_id;
end;
$$;

revoke all on function public.create_staff_invitation(uuid, text, text) from public, anon;
revoke all on function public.revoke_staff_invitation(uuid) from public, anon;
revoke all on function public.unlink_staff_account(uuid) from public, anon;
grant execute on function public.create_staff_invitation(uuid, text, text) to authenticated;
grant execute on function public.revoke_staff_invitation(uuid) to authenticated;
grant execute on function public.unlink_staff_account(uuid) to authenticated;

revoke all on function public.lookup_staff_invitation(text) from public, anon, authenticated;
revoke all on function public.finalize_staff_invitation(text, uuid) from public, anon, authenticated;
grant execute on function public.lookup_staff_invitation(text) to service_role;
grant execute on function public.finalize_staff_invitation(text, uuid) to service_role;

-- ROLLBACK (필요 시 수동 실행):
--   drop function public.finalize_staff_invitation(text, uuid), public.lookup_staff_invitation(text),
--     public.unlink_staff_account(uuid), public.revoke_staff_invitation(uuid), public.create_staff_invitation(uuid, text, text);
--   drop table public.staff_invitations;
--   drop policy staff_delete on public.staff;
--   create policy staff_delete on public.staff for delete to authenticated
--     using (business_id = public.current_business_id() and public.has_role(array['owner','manager']::staff_role[]) and role <> 'owner');
