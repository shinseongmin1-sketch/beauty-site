-- 014: 직접 결제 pending 재확인 경로
--
-- 문제: 직접 결제(kind='manual') 요청 후 토스 응답을 받지 못하면 결제 기록이 pending 으로 남는데,
--       자동결제 스케줄러의 재확인(billing_claim_due)은 kind='auto' 만 다루고 billing_start_manual 은 pending 이 있으면
--       payment_in_progress 로 거부 → 그 매장은 영구히 다시 결제할 수 없었다.
-- 해결: 결과 미확정 직접 결제를 찾아 앱 서버가 토스에 "주문번호로 조회"해 결과를 확정한다 (다시 결제 요청하지 않음 → 중복 결제 없음).
--   - 토스에 성공 기록 → billing_record_result(성공) 로 반영 (기존 함수 재사용)
--   - 토스에 실패/중단 기록 → billing_record_result(실패) (직접 결제 실패는 구독 상태를 바꾸지 않는 기존 규칙 그대로)
--   - 토스에 기록 없음 + 요청 후 충분한 시간 경과 → 결제가 일어나지 않은 것으로 failed(NOT_PROCESSED) → 다시 결제 가능
--   - 그 외(조회 실패 등) → 추측하지 않고 pending 유지, 다음 재확인에서 다시 조회
-- 이 파일은 조회 함수만 추가한다. 상태 전환은 012 의 billing_record_result 를 그대로 쓴다.

create or replace function public.billing_pending_manual(p_business uuid default null, p_min_age_seconds int default 0)
returns table (payment_id uuid, business_id uuid, order_id text, amount int, requested_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.business_id, p.order_id, p.amount, p.requested_at
  from subscription_payments p
  where p.status = 'pending' and p.kind = 'manual'
    and (p_business is null or p.business_id = p_business)
    and p.requested_at <= now() - make_interval(secs => greatest(p_min_age_seconds, 0))
  order by p.requested_at
  limit 100
$$;
revoke all on function public.billing_pending_manual(uuid, int) from public, anon, authenticated;
grant execute on function public.billing_pending_manual(uuid, int) to service_role;

-- ROLLBACK (수동, 필요 시):
--   drop function public.billing_pending_manual(uuid, int);
