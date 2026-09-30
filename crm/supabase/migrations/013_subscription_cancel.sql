-- 013: 구독 자동결제 해지 (2026-09-30 확정 정책)
--
-- 정책
--   - "다음 자동결제만 해지". 현재 결제한 이용기간(체험 중이면 체험 종료 시각)은 줄이지 않고 끝까지 정상 이용.
--   - 해지 후 자동결제·재시도 없음. 이용기간이 끝나면 expired(cancelled) — 기존 만료/차단 정책(조회·내보내기 허용, 쓰기 차단)을 그대로 쓴다.
--   - 데이터와 결제수단(빌링키)은 삭제하지 않는다.
--   - 새 상태값/컬럼 없이 기존 구조를 재사용한다:
--       status = 'canceled'(009 enum), canceled_at(009), expired_reason = 'cancelled'(012)
--       business_is_writable 은 이미 canceled 를 current_period_end 까지 쓰기 허용 (012)
--       billing_claim_due 는 trial/active 만 결제 대상으로 잡으므로 canceled 는 자동결제에서 빠진다 (012)
--   - 해지 취소/재활성화는 이번 범위에서 만들지 않는다. 이용기간이 끝나 expired(cancelled)가 된 뒤에는 기존 직접 결제로 다시 이용할 수 있다.
--
-- 보안
--   - 해지 함수는 매장 ID 를 인자로 받지 않는다: 로그인한 사용자(auth.uid())의 매장만, 대표(owner)만 해지할 수 있다.
--   - 이 함수는 "해지"만 할 수 있고 active 로 되돌리거나 기간을 늘릴 수 없다. 구독 테이블 직접 쓰기 권한은 여전히 없다.
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

-- ── 자동결제 해지 (대표 본인 매장만) ─────────────────────────────────────
create or replace function public.billing_cancel_auto_renewal()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_role staff_role;
  v_sub subscriptions%rowtype;
begin
  select business_id, role into v_business, v_role from profiles where id = auth.uid();
  if v_business is null or v_role is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_sub from subscriptions where business_id = v_business for update;
  if not found then raise exception 'subscription_not_found' using errcode = 'P0002'; end if;

  -- 이미 해지됨: 아무것도 바꾸지 않는다 (중복 처리 없음)
  if v_sub.status = 'canceled' then
    return jsonb_build_object('status', 'canceled', 'already_canceled', true, 'period_end', v_sub.current_period_end, 'canceled_at', v_sub.canceled_at);
  end if;

  if v_sub.status = 'active' and v_sub.current_period_start <= now() and now() < v_sub.current_period_end then
    -- 결제한 이용기간은 그대로 두고 상태만 canceled → 종료 시각까지 쓰기 가능, 자동결제 대상 제외
    update subscriptions set status = 'canceled', canceled_at = now(), updated_at = now() where id = v_sub.id;
    return jsonb_build_object('status', 'canceled', 'period_end', v_sub.current_period_end, 'canceled_at', now());
  end if;

  if v_sub.status = 'trial' and v_sub.trial_ends_at > now() and v_sub.payment_method_id is not null then
    -- 카드를 등록한 체험: 체험 종료 시각까지 이용, 체험 종료일 자동결제는 하지 않는다.
    -- canceled 의 이용 가능 기간(current_period_*)을 체험 기간으로 채운다 (체험 기록 trial_* 는 그대로 둔다).
    update subscriptions
      set status = 'canceled', canceled_at = now(), current_period_start = v_sub.trial_started_at,
          current_period_end = v_sub.trial_ends_at, updated_at = now()
      where id = v_sub.id;
    return jsonb_build_object('status', 'canceled', 'period_end', v_sub.trial_ends_at, 'canceled_at', now());
  end if;

  -- 그 외(카드 없는 체험 = 자동결제 없음, 이미 만료/정지, 기간 밖 active)는 해지할 자동결제가 없다
  raise exception 'not_cancellable' using errcode = '22023';
end;
$$;
revoke all on function public.billing_cancel_auto_renewal() from public, anon;
grant execute on function public.billing_cancel_auto_renewal() to authenticated;

-- ── 해지된 구독의 이용기간 종료 → expired(cancelled) ─────────────────────
-- 쓰기 차단 자체는 business_is_writable 이 종료 시각에 바로 하고(012), 여기서는 저장 상태를 맞춘다. (service_role 전용)
create or replace function public.expire_ended_cancellations(p_business uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  update subscriptions set status = 'expired', expired_reason = 'cancelled', updated_at = now()
  where status = 'canceled' and current_period_end is not null and current_period_end <= now()
    and (p_business is null or business_id = p_business);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.expire_ended_cancellations(uuid) from public, anon, authenticated;
grant execute on function public.expire_ended_cancellations(uuid) to service_role;

-- 로그인 사용자 화면 진입 시 동기화 (012 정의 + 해지 만료 반영). 본인 매장만 처리한다.
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
  perform public.expire_ended_cancellations(v_business);
end;
$$;
-- 자동결제 스케줄러(src/app/api/cron/billing/route.ts)는 billing_claim_due 전에 expire_ended_cancellations() 를 호출한다.

-- ROLLBACK (수동, 필요 시):
--   drop function public.billing_cancel_auto_renewal();
--   drop function public.expire_ended_cancellations(uuid);
--   -- sync_my_subscription 은 012 의 정의로 다시 create or replace
