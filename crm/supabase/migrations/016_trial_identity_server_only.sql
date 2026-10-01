-- 016: 무료체험 식별값(사업자번호·전화번호 해시)은 앱 서버만 넣을 수 있게 한다 (S-5)
--
-- 문제
--   create_my_business() / set_business_number() 는 authenticated(브라우저 로그인 권한)로 실행할 수 있고
--   사업자번호 "해시"를 인자로 받는다. 해시는 원래 앱 서버가 비밀값(BUSINESS_NUMBER_PEPPER)으로 계산하지만,
--   로그인한 사용자가 브라우저에서 RPC 를 직접 호출하면 아무 64자리 hex 와 p_phone_hash = null 을 넣을 수 있어
--   서버의 해시 계산과 전화번호 한도를 건너뛰고 새 계정마다 무료체험을 다시 받을 수 있었다.
--
-- 해결
--   1) 두 함수의 authenticated 실행 권한을 회수한다 (함수 본문·체험 판단 로직은 009 그대로, 바꾸지 않는다).
--   2) service_role 전용 래퍼 create_my_business_as() / set_business_number_as() 를 연다.
--      앱 서버가 "세션으로 확인한 사용자 id" 와 서버에서 계산한 해시를 넘기면, 래퍼가 그 사용자로서(auth.uid())
--      기존 함수를 그대로 실행한다 → 계정당 매장 1개, 대표 전용, 감사 로그의 행위자(대표 본인)가 모두 009 와 같다.
--      (래퍼는 이 트랜잭션 안에서만 요청 사용자 정보를 바꾸고, 끝나면 원래 값으로 되돌린다)
--
-- 적용 순서: 012~015 와 같은 점검 시간에 016 까지 적용한 뒤 곧바로 새 앱 코드를 배포한다.
--   (016 적용 후 구버전 앱은 온보딩/사업자번호 등록이 권한 오류로 실패한다. 반대로 새 앱 코드는 016 이 있어야 동작한다)
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

revoke all on function public.create_my_business(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.set_business_number(text, text) from public, anon, authenticated;

-- 지정한 사용자로서 함수를 실행하기 위한 요청 사용자 정보 전환 (auth.uid() 는 claim.sub → claims.sub 순으로 읽는다)
create or replace function public._act_as_user(p_user uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    (coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) || jsonb_build_object('sub', p_user))::text, true);
end;
$$;
revoke all on function public._act_as_user(uuid) from public, anon, authenticated, service_role;

create or replace function public.create_my_business_as(
  p_user uuid,
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
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
  v_business uuid;
begin
  perform public._act_as_user(p_user);
  v_business := public.create_my_business(p_name, p_phone, p_address, p_representative_name,
                                           p_business_number_hash, p_business_number_masked, p_phone_hash);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
  return v_business;
end;
$$;
revoke all on function public.create_my_business_as(uuid, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_my_business_as(uuid, text, text, text, text, text, text, text) to service_role;

create or replace function public.set_business_number_as(p_user uuid, p_hash text, p_masked text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev_sub text := current_setting('request.jwt.claim.sub', true);
  v_prev_claims text := current_setting('request.jwt.claims', true);
begin
  perform public._act_as_user(p_user);
  perform public.set_business_number(p_hash, p_masked);
  perform set_config('request.jwt.claim.sub', coalesce(v_prev_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_prev_claims, ''), true);
end;
$$;
revoke all on function public.set_business_number_as(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_business_number_as(uuid, text, text) to service_role;

-- ROLLBACK (수동, 필요 시):
--   drop function public.set_business_number_as(uuid, text, text);
--   drop function public.create_my_business_as(uuid, text, text, text, text, text, text, text);
--   drop function public._act_as_user(uuid);
--   grant execute on function public.create_my_business(text, text, text, text, text, text, text) to authenticated;
--   grant execute on function public.set_business_number(text, text) to authenticated;
--   (앱 코드도 016 이전 버전 — 브라우저 세션으로 create_my_business / set_business_number 호출 — 으로 되돌려야 한다)
