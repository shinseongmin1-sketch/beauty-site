-- 직원 초대/연결/해제(008) 테스트

drop table if exists pg_temp.fin_result;
drop table if exists pg_temp.results;
create temp table results (name text, ok boolean, detail text);
grant all on results to public;

create or replace function pg_temp.inv_fail(p_name text, p_uid uuid, p_stmt text, p_state text default null)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text := 'no error raised';
begin
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    set local role authenticated;
    execute p_stmt;
  exception when others then
    if p_state is null or sqlstate = p_state then v_ok := true; v_detail := sqlstate || ' ' || sqlerrm;
    else v_detail := 'wrong sqlstate ' || sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

create or replace function pg_temp.inv_rows(p_name text, p_uid uuid, p_stmt text, p_rows int)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text; v_n int;
begin
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    set local role authenticated;
    execute p_stmt;
    get diagnostics v_n = row_count;
    v_ok := (v_n = p_rows); v_detail := 'rows=' || v_n || ' expected=' || p_rows;
  exception when others then v_detail := sqlstate || ' ' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

-- 슈퍼유저(서버가 service_role 로 호출하는 함수를 흉내)로 실행: 예외가 나야 PASS
create or replace function pg_temp.inv_srv_fail(p_name text, p_stmt text, p_state text default null)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text := 'no error raised';
begin
  begin execute p_stmt;
  exception when others then
    if p_state is null or sqlstate = p_state then v_ok := true; v_detail := sqlstate || ' ' || sqlerrm;
    else v_detail := 'wrong sqlstate ' || sqlstate || ' ' || sqlerrm; end if;
  end;
  insert into results values (p_name, v_ok, v_detail);
end $$;

-- 대표(90..01)로 초대를 만들어 두는 셋업용 (결과 기록 없음)
create or replace function pg_temp.inv_make(p_staff uuid, p_email text, p_hash text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true);
  set local role authenticated;
  perform public.create_staff_invitation(p_staff, p_email, p_hash);
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ── 셋업: 사업장 P(대표 O, 관리자 M, 직원 S, 라벨 담당자 L1~L4 등), 사업장 Q(대표 Z) ──
insert into auth.users (id, email, raw_user_meta_data) values
  ('90000000-0000-0000-0000-000000000001', 'p-owner@inv.local',   '{"full_name":"P대표"}'),
  ('90000000-0000-0000-0000-000000000002', 'p-manager@inv.local', '{"full_name":"P관리자"}'),
  ('90000000-0000-0000-0000-000000000003', 'p-staff@inv.local',   '{"full_name":"P직원"}'),
  ('90000000-0000-0000-0000-000000000004', 'q-owner@inv.local',   '{"full_name":"Q대표"}'),
  ('90000000-0000-0000-0000-000000000005', 'p-linked-staff@inv.local', '{"full_name":"연결직원"}'),
  ('90000000-0000-0000-0000-000000000006', 'p-linked-mgr@inv.local',   '{"full_name":"연결관리자"}');
insert into businesses (id, owner_id, name) values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'P매장'),
  ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000004', 'Q매장');

insert into subscriptions (business_id, status, trial_source, trial_started_at, trial_ends_at)
  select b.id, 'trial', 'signup', now(), now() + interval '3 months' from businesses b
  where not exists (select 1 from subscriptions s where s.business_id = b.id);
update profiles set business_id='91000000-0000-0000-0000-000000000001', role='owner'   where id='90000000-0000-0000-0000-000000000001';
update profiles set business_id='91000000-0000-0000-0000-000000000001', role='manager' where id='90000000-0000-0000-0000-000000000002';
update profiles set business_id='91000000-0000-0000-0000-000000000001', role='staff'   where id='90000000-0000-0000-0000-000000000003';
update profiles set business_id='91000000-0000-0000-0000-000000000002', role='owner'   where id='90000000-0000-0000-0000-000000000004';
update profiles set business_id='91000000-0000-0000-0000-000000000001', role='staff'   where id='90000000-0000-0000-0000-000000000005';
update profiles set business_id='91000000-0000-0000-0000-000000000001', role='manager' where id='90000000-0000-0000-0000-000000000006';
insert into staff (id, business_id, profile_id, name, role) values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'P대표', 'owner'),
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'P관리자', 'manager'),
  ('92000000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 'P직원', 'staff'),
  ('92000000-0000-0000-0000-0000000000a1', '91000000-0000-0000-0000-000000000001', null, 'L1-직원급', 'staff'),
  ('92000000-0000-0000-0000-0000000000a2', '91000000-0000-0000-0000-000000000001', null, 'L2-관리자급', 'manager'),
  ('92000000-0000-0000-0000-0000000000a3', '91000000-0000-0000-0000-000000000001', null, 'L3-직원급(만료시험)', 'staff'),
  ('92000000-0000-0000-0000-0000000000a4', '91000000-0000-0000-0000-000000000001', null, 'L4-직원급(수락시험)', 'staff'),
  ('92000000-0000-0000-0000-0000000000a5', '91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000005', '연결직원', 'staff'),
  ('92000000-0000-0000-0000-0000000000a6', '91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000006', '연결관리자', 'manager'),
  ('92000000-0000-0000-0000-000000000009', '91000000-0000-0000-0000-000000000002', null, 'Q라벨', 'staff');

-- ── 초대 생성 권한 ────────────────────────────────────────────────────
select pg_temp.inv_rows('관리자: 직원급 담당자 초대 가능', '90000000-0000-0000-0000-000000000002', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a1', 'New.Staff@Example.com', repeat('a', 64))$$, 1);
select pg_temp.inv_fail('관리자: 관리자급 담당자 초대 → 차단(대표 전용)', '90000000-0000-0000-0000-000000000002', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a2', 'mgr@example.com', repeat('b', 64))$$, '42501');
select pg_temp.inv_rows('대표: 관리자급 담당자 초대 가능', '90000000-0000-0000-0000-000000000001', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a2', 'mgr@example.com', repeat('b', 64))$$, 1);
select pg_temp.inv_fail('직원: 초대 생성 → 차단', '90000000-0000-0000-0000-000000000003', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a1', 'x@example.com', repeat('c', 64))$$, '42501');
select pg_temp.inv_fail('다른 사업장(Q) 대표: P 담당자 초대 → not_found', '90000000-0000-0000-0000-000000000004', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a1', 'x@example.com', repeat('c', 64))$$, 'P0002');
select pg_temp.inv_fail('대표: 자기(대표) 담당자 행 초대 → 차단', '90000000-0000-0000-0000-000000000001', $$select public.create_staff_invitation('92000000-0000-0000-0000-000000000001', 'x@example.com', repeat('c', 64))$$, '42501');
select pg_temp.inv_fail('이미 계정이 연결된 담당자 초대 → 차단', '90000000-0000-0000-0000-000000000001', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a5', 'x@example.com', repeat('c', 64))$$, '23505');
select pg_temp.inv_fail('이메일 형식 오류 → 차단', '90000000-0000-0000-0000-000000000001', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a3', 'not-an-email', repeat('c', 64))$$, '22023');
select pg_temp.inv_fail('토큰 해시 형식 오류 → 차단', '90000000-0000-0000-0000-000000000001', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a3', 'ok@example.com', 'short')$$, '22023');
select pg_temp.inv_fail('이미 가입된 이메일로 초대 → 차단(email_taken)', '90000000-0000-0000-0000-000000000001', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a3', 'p-staff@inv.local', repeat('d', 64))$$, '23505');
select pg_temp.inv_fail('다른 담당자에게 대기 중인 같은 이메일로 초대 → 차단', '90000000-0000-0000-0000-000000000001', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a3', 'new.staff@example.com', repeat('d', 64))$$, '23505');

-- 재발급: 같은 담당자에게 새 초대 → 이전 초대는 자동 무효
select pg_temp.inv_rows('대표: 같은 담당자 재발급 가능', '90000000-0000-0000-0000-000000000001', $$select public.create_staff_invitation('92000000-0000-0000-0000-0000000000a1', 'new.staff@example.com', repeat('e', 64))$$, 1);
insert into results select '재발급 시 이전 초대는 무효(revoked)이고 새 초대만 유효',
  (select revoked_at is not null from staff_invitations where token_hash = repeat('a', 64))
  and (select revoked_at is null and accepted_at is null from staff_invitations where token_hash = repeat('e', 64)), null;
insert into results select '이메일은 소문자로 정규화되어 저장',
  (select email from staff_invitations where token_hash = repeat('e', 64)) = 'new.staff@example.com', null;

-- ── 조회 권한 / 토큰 비노출 ──────────────────────────────────────────
select pg_temp.inv_rows('대표: 자기 사업장 초대 목록 조회', '90000000-0000-0000-0000-000000000001', 'select id, email, expires_at from staff_invitations', 3);
select pg_temp.inv_rows('직원: 초대 목록 조회 → 0행', '90000000-0000-0000-0000-000000000003', 'select id, email from staff_invitations', 0);
select pg_temp.inv_rows('다른 사업장(Q) 대표: P 초대 조회 → 0행', '90000000-0000-0000-0000-000000000004', 'select id, email from staff_invitations', 0);
select pg_temp.inv_fail('대표도 token_hash 컬럼은 조회 불가', '90000000-0000-0000-0000-000000000001', 'select token_hash from staff_invitations');
select pg_temp.inv_fail('초대 테이블 직접 INSERT 불가', '90000000-0000-0000-0000-000000000001', $$insert into staff_invitations (business_id, staff_id, email, role, token_hash, expires_at) values ('91000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000a3', 'x@example.com', 'staff', repeat('f', 64), now() + interval '1 day')$$);
select pg_temp.inv_fail('초대 테이블 직접 UPDATE 불가(만료 연장 등)', '90000000-0000-0000-0000-000000000001', $$update staff_invitations set expires_at = now() + interval '365 days'$$);

-- ── 수락 함수는 브라우저 권한(authenticated)으로 호출 불가 ─────────────
select pg_temp.inv_fail('authenticated: lookup_staff_invitation 호출 → 차단', '90000000-0000-0000-0000-000000000001', $$select * from public.lookup_staff_invitation(repeat('e', 64))$$);
select pg_temp.inv_fail('authenticated: finalize_staff_invitation 호출 → 차단', '90000000-0000-0000-0000-000000000001', $$select public.finalize_staff_invitation(repeat('e', 64), '90000000-0000-0000-0000-000000000001')$$);
insert into results select 'service_role 만 수락 함수 실행 가능',
  has_function_privilege('service_role', 'public.finalize_staff_invitation(text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.lookup_staff_invitation(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.finalize_staff_invitation(text,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.lookup_staff_invitation(text)', 'execute'), null;

-- ── 수락 흐름 (서버가 service_role 로 실행하는 부분) ────────────────────
insert into results select 'lookup: 유효한 초대는 사업장명/이메일/직급을 반환',
  (select count(*) from public.lookup_staff_invitation(repeat('e', 64)) where business_name = 'P매장' and email = 'new.staff@example.com' and role = 'staff') = 1, null;
insert into results select 'lookup: 무효화(재발급 전) 초대는 조회 안 됨', (select count(*) from public.lookup_staff_invitation(repeat('a', 64))) = 0, null;
insert into results select 'lookup: 존재하지 않는 토큰은 조회 안 됨', (select count(*) from public.lookup_staff_invitation(repeat('0', 64))) = 0, null;

-- 만료 시험: L3 에 초대 후 강제로 만료시킴
select pg_temp.inv_make('92000000-0000-0000-0000-0000000000a3', 'expired@example.com', repeat('1', 64));
update staff_invitations set expires_at = now() - interval '1 minute' where token_hash = repeat('1', 64);
insert into results select 'lookup: 만료된 초대는 조회 안 됨', (select count(*) from public.lookup_staff_invitation(repeat('1', 64))) = 0, null;
insert into auth.users (id, email, raw_user_meta_data) values ('90000000-0000-0000-0000-0000000000e1', 'expired@example.com', '{"full_name":"만료"}');
select pg_temp.inv_srv_fail('finalize: 만료된 초대 → 실패', $$select public.finalize_staff_invitation(repeat('1', 64), '90000000-0000-0000-0000-0000000000e1')$$, 'P0002');

-- 이메일 불일치: 다른 이메일의 계정으로 수락 시도
insert into auth.users (id, email, raw_user_meta_data) values ('90000000-0000-0000-0000-0000000000e2', 'attacker@example.com', '{"full_name":"공격자"}');
select pg_temp.inv_srv_fail('finalize: 초대 이메일과 다른 계정 → 실패(email_mismatch)', $$select public.finalize_staff_invitation(repeat('e', 64), '90000000-0000-0000-0000-0000000000e2')$$, '42501');
insert into results select 'finalize 실패 후에도 초대는 그대로 유효, 공격자 프로필은 사업장 없음',
  (select accepted_at is null from staff_invitations where token_hash = repeat('e', 64))
  and (select business_id is null from profiles where id = '90000000-0000-0000-0000-0000000000e2'), null;

-- 정상 수락
insert into auth.users (id, email, raw_user_meta_data) values ('90000000-0000-0000-0000-0000000000e3', 'new.staff@example.com', '{"full_name":"신규직원"}');
create temp table fin_result as select public.finalize_staff_invitation(repeat('e', 64), '90000000-0000-0000-0000-0000000000e3') as staff_id;
insert into results select 'finalize: 정상 수락 → 담당자와 프로필이 연결되고 초대 사업장/직급으로 고정',
  (select staff_id from fin_result) = '92000000-0000-0000-0000-0000000000a1'
  and (select profile_id from staff where id = '92000000-0000-0000-0000-0000000000a1') = '90000000-0000-0000-0000-0000000000e3'
  and (select business_id from profiles where id = '90000000-0000-0000-0000-0000000000e3') = '91000000-0000-0000-0000-000000000001'
  and (select role from profiles where id = '90000000-0000-0000-0000-0000000000e3') = 'staff'
  and (select accepted_at is not null and accepted_profile_id = '90000000-0000-0000-0000-0000000000e3' from staff_invitations where token_hash = repeat('e', 64)), null;
select pg_temp.inv_srv_fail('finalize: 같은 초대 재사용 → 실패(1회용)', $$select public.finalize_staff_invitation(repeat('e', 64), '90000000-0000-0000-0000-0000000000e3')$$, 'P0002');
insert into results select 'lookup: 수락된 초대는 더 이상 조회 안 됨', (select count(*) from public.lookup_staff_invitation(repeat('e', 64))) = 0, null;
-- 수락한 직원은 초대받은 사업장(P)만 보인다
select pg_temp.inv_rows('수락한 신규 직원: 다른 사업장(Q) 담당자 조회 → 0행', '90000000-0000-0000-0000-0000000000e3', $$select * from staff where business_id = '91000000-0000-0000-0000-000000000002'$$, 0);
select pg_temp.inv_rows('수락한 신규 직원: 초대받은 사업장(P) 담당자 조회 가능', '90000000-0000-0000-0000-0000000000e3', $$select * from staff where business_id = '91000000-0000-0000-0000-000000000001'$$, 9);
select pg_temp.inv_fail('수락한 신규 직원: 직급 상승 시도 → 차단', '90000000-0000-0000-0000-0000000000e3', $$update profiles set role = 'owner' where id = '90000000-0000-0000-0000-0000000000e3'$$);

-- 이미 사업장이 있는 계정으로는 수락 불가
select pg_temp.inv_make('92000000-0000-0000-0000-0000000000a4', 'other@example.com', repeat('2', 64));
select pg_temp.inv_srv_fail('finalize: 이미 다른 사업장에 속한 계정 → 실패', $$select public.finalize_staff_invitation(repeat('2', 64), '90000000-0000-0000-0000-000000000004')$$, '42501');

-- ── 연결된 담당자 행 삭제 불가 ─────────────────────────────────────────
select pg_temp.inv_rows('대표/관리자도 연결된 담당자 행은 DELETE 불가(0행)', '90000000-0000-0000-0000-000000000001', $$delete from staff where id = '92000000-0000-0000-0000-0000000000a5'$$, 0);
select pg_temp.inv_rows('연결 없는 담당자 행은 DELETE 가능', '90000000-0000-0000-0000-000000000001', $$delete from staff where id = '92000000-0000-0000-0000-0000000000a3'$$, 1);

-- ── 해제 ──────────────────────────────────────────────────────────────
select pg_temp.inv_fail('직원: 계정 해제 → 차단', '90000000-0000-0000-0000-000000000003', $$select public.unlink_staff_account('92000000-0000-0000-0000-0000000000a5')$$, '42501');
select pg_temp.inv_fail('관리자: 관리자급 계정 해제 → 차단(대표 전용)', '90000000-0000-0000-0000-000000000002', $$select public.unlink_staff_account('92000000-0000-0000-0000-0000000000a6')$$, '42501');
select pg_temp.inv_fail('대표 계정 해제 → 차단', '90000000-0000-0000-0000-000000000001', $$select public.unlink_staff_account('92000000-0000-0000-0000-000000000001')$$, '42501');
select pg_temp.inv_fail('다른 사업장(Q) 대표: P 직원 해제 → not_found', '90000000-0000-0000-0000-000000000004', $$select public.unlink_staff_account('92000000-0000-0000-0000-0000000000a5')$$, 'P0002');
select pg_temp.inv_fail('연결 안 된 담당자 해제 → not_linked', '90000000-0000-0000-0000-000000000001', $$select public.unlink_staff_account('92000000-0000-0000-0000-0000000000a2')$$, 'P0002');
select pg_temp.inv_rows('관리자: 직원급 계정 해제 가능', '90000000-0000-0000-0000-000000000002', $$select public.unlink_staff_account('92000000-0000-0000-0000-0000000000a5')$$, 1);
insert into results select '해제 후: 프로필의 사업장 접근 제거 + 담당자 연결 끊김',
  (select business_id is null from profiles where id = '90000000-0000-0000-0000-000000000005')
  and (select profile_id is null from staff where id = '92000000-0000-0000-0000-0000000000a5'), null;
select pg_temp.inv_rows('해제된 계정: 이전 사업장 고객 조회 → 0행', '90000000-0000-0000-0000-000000000005', 'select * from customers', 0);
select pg_temp.inv_rows('대표: 관리자급 계정 해제 가능', '90000000-0000-0000-0000-000000000001', $$select public.unlink_staff_account('92000000-0000-0000-0000-0000000000a6')$$, 1);

-- ── 초대 취소 ─────────────────────────────────────────────────────────
select pg_temp.inv_rows('대표: 대기 초대 취소', '90000000-0000-0000-0000-000000000001', $$select public.revoke_staff_invitation('92000000-0000-0000-0000-0000000000a2')$$, 1);
select pg_temp.inv_fail('직원: 초대 취소 → 차단', '90000000-0000-0000-0000-000000000003', $$select public.revoke_staff_invitation('92000000-0000-0000-0000-0000000000a2')$$, '42501');
insert into results select '취소된 초대는 조회 안 됨', (select count(*) from public.lookup_staff_invitation(repeat('b', 64))) = 0, null;

select case when ok then 'PASS' else 'FAIL' end as result, name, detail from results order by ok, name;
