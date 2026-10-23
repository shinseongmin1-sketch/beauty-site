-- 019: 구독 연장 = 자동결제 해지 취소 (2026-10-23 사용자 요청: "구독 설정"에서 연장·해지)
--
-- 정책
--   - 해지(canceled)했지만 아직 이용기간이 남아 있으면, 대표가 자동결제를 다시 켤 수 있다.
--   - 다시 켜도 지금 결제하지 않는다. 원래 결제일(이용기간 종료 시각, 체험이면 체험 종료 시각)에 기존처럼 자동결제된다.
--   - 결제수단이 있어야 하고(해지해도 결제수단은 지우지 않으므로 보통 있다), 자동결제 동의를 다시 받아 기록한다.
--   - 이용기간이 이미 끝났으면(expired) 연장할 수 없다 → 기존 "결제하기"(직접 결제)로 다시 이용한다.
--   - 체험 중에 해지한 경우(013: current_period_* 를 체험 기간으로 채움, 결제 기록 없음)는 체험(trial)으로 되돌린다.
--
-- 보안
--   - 매장 ID 를 인자로 받지 않는다: 로그인한 사용자(auth.uid())의 매장만, 대표(owner)만.
--   - 이 함수는 canceled → active/trial 로만 되돌린다. 기간을 늘리거나 결제 없이 이용기간을 만들 수 없다.
--
-- 되돌리기: drop function public.billing_resume_auto_renewal(text);

create or replace function public.billing_resume_auto_renewal(p_consent_version text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid;
  v_role staff_role;
  v_sub subscriptions%rowtype;
  v_from_trial boolean;
begin
  select business_id, role into v_business, v_role from profiles where id = auth.uid();
  if v_business is null or v_role is distinct from 'owner' then raise exception 'forbidden' using errcode = '42501'; end if;
  if coalesce(p_consent_version, '') !~ '^[A-Za-z0-9._-]{3,40}$' then raise exception 'consent_required' using errcode = '22023'; end if;
  select * into v_sub from subscriptions where business_id = v_business for update;
  if not found then raise exception 'subscription_not_found' using errcode = 'P0002'; end if;

  -- 이미 자동결제가 켜져 있음 (중복 처리 없음)
  if v_sub.status in ('active', 'trial') then
    return jsonb_build_object('status', v_sub.status, 'already_active', true);
  end if;
  -- 해지 상태 + 이용기간이 남아 있을 때만
  if v_sub.status <> 'canceled' or v_sub.current_period_end is null or v_sub.current_period_end <= now() then
    raise exception 'not_resumable' using errcode = '22023';
  end if;
  if v_sub.payment_method_id is null
     or not exists (select 1 from subscription_payment_methods m where m.id = v_sub.payment_method_id and m.status = 'active') then
    raise exception 'payment_method_required' using errcode = '22023';
  end if;

  v_from_trial := v_sub.last_payment_at is null
    and v_sub.trial_ends_at is not null and v_sub.current_period_end = v_sub.trial_ends_at;

  if v_from_trial then
    update subscriptions
      set status = 'trial', canceled_at = null, current_period_start = null, current_period_end = null,
          auto_renew_consented_at = now(), auto_renew_consent_version = p_consent_version, updated_at = now()
      where id = v_sub.id;
    return jsonb_build_object('status', 'trial', 'next_charge_at', v_sub.trial_ends_at);
  end if;

  update subscriptions
    set status = 'active', canceled_at = null,
        auto_renew_consented_at = now(), auto_renew_consent_version = p_consent_version, updated_at = now()
    where id = v_sub.id;
  return jsonb_build_object('status', 'active', 'next_charge_at', v_sub.current_period_end);
end;
$$;
revoke all on function public.billing_resume_auto_renewal(text) from public, anon;
grant execute on function public.billing_resume_auto_renewal(text) to authenticated;
