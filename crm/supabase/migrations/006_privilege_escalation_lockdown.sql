-- 006: 권한 상승 차단 (2/2) - 직접 수정 권한 회수 (contract)
--
-- 반드시 005 적용 + 새 앱 코드(온보딩/직원 권한 변경이 함수 호출로 바뀐 버전) 배포 이후에 적용한다.
-- (그 전에 적용하면 구버전 앱의 온보딩이 실패한다.)
--
-- 방어 2겹:
--   1) 컬럼 단위 GRANT: authenticated 가 수정할 수 있는 컬럼만 허용
--   2) 트리거: 권한 관련 컬럼(role / business_id / profile_id)은 authenticated·anon 의 직접 변경을 거부.
--      SECURITY DEFINER 함수(소유자 postgres)와 service_role 은 통과한다.
--
-- 주의: 이후 businesses / staff 에 컬럼을 추가하면 그 컬럼의 UPDATE/INSERT GRANT 도 함께 추가해야 한다.
--
-- 되돌리기: 이 파일 맨 아래 "ROLLBACK" 주석 참고.

-- ── profiles ─────────────────────────────────────────────────────────
drop policy if exists "profiles_update_self" on profiles;
drop policy if exists "profiles_insert_self" on profiles;

revoke insert, update, delete on profiles from anon, authenticated;
grant update (full_name, phone) on profiles to authenticated;

create policy "profiles_update_self" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if new.id is distinct from old.id
       or new.role is distinct from old.role
       or new.business_id is distinct from old.business_id then
      raise exception 'privileged_column_change_denied' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_privileged_columns on profiles;
create trigger guard_profile_privileged_columns
  before update on profiles
  for each row execute function public.guard_profile_privileged_columns();

-- ── businesses ───────────────────────────────────────────────────────
-- 생성은 create_my_business() 만 통과. owner_id 변경/삭제 불가, 수정 가능한 컬럼만 열어둠.
drop policy if exists "businesses_insert" on businesses;
drop policy if exists "businesses_update" on businesses;

revoke insert, update, delete on businesses from anon, authenticated;
grant update (name, phone, address, business_hours, naver_booking_id, toss_client_key)
  on businesses to authenticated;

create policy "businesses_update" on businesses
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ── staff ────────────────────────────────────────────────────────────
-- 로그인 계정 연결(profile_id)과 owner 등급은 직접 쓸 수 없다.
-- 연결된 직원의 등급 변경은 set_member_role() 로만 가능하다.
create or replace function public.guard_staff_privileged_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.profile_id is not null or new.role = 'owner' then
        raise exception 'privileged_column_change_denied' using errcode = '42501';
      end if;
    else
      if new.business_id is distinct from old.business_id
         or new.profile_id is distinct from old.profile_id
         or (new.role is distinct from old.role
             and (old.profile_id is not null or old.role = 'owner' or new.role = 'owner')) then
        raise exception 'privileged_column_change_denied' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_staff_privileged_columns on staff;
create trigger guard_staff_privileged_columns
  before insert or update on staff
  for each row execute function public.guard_staff_privileged_columns();

-- ROLLBACK (필요 시 수동 실행):
--   drop trigger guard_staff_privileged_columns on staff;
--   drop trigger guard_profile_privileged_columns on profiles;
--   grant insert, update, delete on profiles, businesses to authenticated;
--   create policy "profiles_insert_self" on profiles for insert with check (id = auth.uid());
--   create policy "businesses_insert" on businesses for insert with check (owner_id = auth.uid());
