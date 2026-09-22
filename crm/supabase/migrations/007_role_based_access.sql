-- 007: 직급별 접근 제어 (Role-based RLS)
--
-- 배경: 기존 RLS 는 "같은 사업장이면 전부 허용"이라 직원(staff) 계정이 API 를 직접 호출하면
-- 매출/고객/담당자 삭제, 결제수단·알림설정 변경, 마케팅 기록 생성이 가능했다 (F1).
--
-- 직급 (profiles.role, enum staff_role):
--   owner   = 대표 관리자   manager = 관리자(admin)   staff = 직원(employee)
--
-- 정책 요약
--   A. customers / reservations / consultations
--        조회·등록·수정: owner, manager, staff        삭제: owner, manager
--   B. staff(담당자) / services / reservation_groups / reservation_types /
--      consultation_types / customer_grades / customer_tags
--        조회: 전 직급 (예약·상담 화면의 선택 목록에 필요)   등록·수정·삭제: owner, manager
--        staff 는 owner 행(대표) 삭제 불가
--   C. payments / payment_methods            조회·등록·수정·삭제: owner, manager   (직원: 접근 불가)
--   D. notification_settings / marketing_messages   조회·수정: owner 만 (관리자·직원: 접근 불가)
--   E. customer_tag_links                     고객 수정의 일부이므로 전 직급
--   businesses(사업장 정보) 수정은 006 에서 이미 owner 전용.
--   profiles 의 role/business_id 변경은 005/006 의 함수로만 가능 (직급 변경은 owner 전용).
--
-- 모든 정책은 사업장 격리(business_id = current_business_id())를 그대로 포함한다.
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

create or replace function public.has_role(p_roles staff_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = any (p_roles) from profiles p where p.id = auth.uid() and p.business_id is not null),
    false
  )
$$;

revoke all on function public.has_role(staff_role[]) from public, anon;
grant execute on function public.has_role(staff_role[]) to authenticated;

do $$
declare
  t text;
  own constant text := 'business_id = public.current_business_id()';
  mgr constant text := 'public.has_role(array[''owner'',''manager'']::staff_role[])';
  ownr constant text := 'public.has_role(array[''owner'']::staff_role[])';
begin
  -- 기존 "같은 사업장이면 전부 허용" 정책 제거
  foreach t in array array[
    'staff','customers','services','reservations','payments','reservation_groups','reservation_types',
    'consultations','customer_grades','customer_tags','customer_tag_links','notification_settings',
    'marketing_messages','consultation_types','payment_methods'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('revoke all on table public.%I from anon', t);
  end loop;

  -- A. 조회·등록·수정: 전 직급 / 삭제: owner, manager
  foreach t in array array['customers','reservations','consultations'] loop
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select', t, own);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert', t, own);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_update', t, own, own);
    execute format('create policy %I on public.%I for delete to authenticated using (%s and %s)', t || '_delete', t, own, mgr);
  end loop;

  -- B. 조회: 전 직급 / 쓰기: owner, manager
  foreach t in array array[
    'services','reservation_groups','reservation_types','consultation_types','customer_grades','customer_tags'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select', t, own);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s and %s)', t || '_insert', t, own, mgr);
    execute format('create policy %I on public.%I for update to authenticated using (%s and %s) with check (%s and %s)', t || '_update', t, own, mgr, own, mgr);
    execute format('create policy %I on public.%I for delete to authenticated using (%s and %s)', t || '_delete', t, own, mgr);
  end loop;

  -- 담당자(staff): B 와 같지만 대표(owner) 행은 삭제 불가
  create policy staff_select on public.staff for select to authenticated using (business_id = public.current_business_id());
  execute format('create policy staff_insert on public.staff for insert to authenticated with check (%s and %s)', own, mgr);
  execute format('create policy staff_update on public.staff for update to authenticated using (%s and %s) with check (%s and %s)', own, mgr, own, mgr);
  execute format('create policy staff_delete on public.staff for delete to authenticated using (%s and %s and role <> ''owner'')', own, mgr);

  -- C. 매출/결제수단: owner, manager 만 (직원은 조회도 불가)
  foreach t in array array['payments','payment_methods'] loop
    execute format('create policy %I on public.%I for all to authenticated using (%s and %s) with check (%s and %s)', t || '_managers', t, own, mgr, own, mgr);
  end loop;

  -- D. 알림 설정 / 마케팅: owner 만
  foreach t in array array['notification_settings','marketing_messages'] loop
    execute format('create policy %I on public.%I for all to authenticated using (%s and %s) with check (%s and %s)', t || '_owner', t, own, ownr, own, ownr);
  end loop;

  -- E. 고객 태그 연결: 고객 수정의 일부 → 전 직급
  execute format('create policy customer_tag_links_members on public.customer_tag_links for all to authenticated using (%s) with check (%s)', own, own);
end $$;

-- ROLLBACK (필요 시 수동 실행): 정책을 모두 지우고 예전 "사업장 단위 전체 허용" 정책으로 복원
--   do $r$ declare t text; p record; begin
--     foreach t in array array['staff','customers','services','reservations','payments','reservation_groups','reservation_types',
--       'consultations','customer_grades','customer_tags','customer_tag_links','notification_settings','marketing_messages',
--       'consultation_types','payment_methods'] loop
--       for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
--         execute format('drop policy %I on public.%I', p.policyname, t); end loop;
--       execute format('create policy %I on public.%I for all using (business_id = current_business_id()) with check (business_id = current_business_id())', t||'_rw', t);
--     end loop; end $r$;
--   drop function public.has_role(staff_role[]);
