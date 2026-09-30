import { redirect } from "next/navigation";

// 구독(무료체험) 상태. 실제 "쓰기 가능 여부"의 유일한 기준은 DB(business_is_writable + RLS)다.
// 여기서 계산하는 값은 화면 안내(배너/문구)와 서버 액션의 "친절한 사전 차단"용이며,
// 이 검사를 우회해도 DB 가 쓰기를 다시 막는다. 클라이언트(브라우저)에서는 계산하지 않고 서버에서만 쓴다.

export type SubscriptionStatus = "trial" | "active" | "expired" | "canceled" | "suspended";

export interface SubscriptionRow {
  status: SubscriptionStatus;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_denied_reason: string | null;
  current_period_start?: string | null;
  current_period_end: string | null;
  expired_reason?: ExpiredReason | null;
  payment_method_id?: string | null;
  billing_cycle?: string | null;
}

/** expired 가 된 이유: 체험 종료 / 자동결제 실패 / 해지 */
export type ExpiredReason = "trial_expired" | "payment_failed" | "cancelled";

export interface SubscriptionState {
  /** 저장된 값이 trial 이어도 종료 시각이 지났으면 expired 로 계산한 "실효 상태" */
  status: SubscriptionStatus;
  stored: SubscriptionStatus | "none";
  writable: boolean;
  trialEndsAt: string | null;
  daysLeft: number | null;
  deniedReason: string | null;
  expiredReason: ExpiredReason | null;
  hasPaymentMethod: boolean;
  periodEnd: string | null;
  /** 결제일이 지났지만 자동결제 결과가 아직 반영되지 않은 상태 (체험 종료/기간 종료 직후) */
  awaitingPayment: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

export function computeSubscriptionState(row: SubscriptionRow | null | undefined, now = new Date()): SubscriptionState {
  // 구독 정보가 없으면 쓰기 불가로 본다 (DB 도 동일하게 fail-closed).
  if (!row) {
    return { status: "expired", stored: "none", writable: false, trialEndsAt: null, daysLeft: null, deniedReason: null, expiredReason: null, hasPaymentMethod: false, periodEnd: null, awaitingPayment: false };
  }

  const trialEnds = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
  const periodEnd = row.current_period_end ? new Date(row.current_period_end) : null;

  let status: SubscriptionStatus = row.status;
  if (row.status === "trial" && (!trialEnds || trialEnds.getTime() <= now.getTime())) status = "expired";

  const periodStart = row.current_period_start ? new Date(row.current_period_start) : null;
  // DB business_is_writable 과 같은 규칙: active 는 "이용기간 안"일 때만 쓰기 가능 (화면 안내용, 실제 차단은 DB/RLS)
  const activeInPeriod =
    row.status === "active" && !!periodStart && !!periodEnd && periodStart.getTime() <= now.getTime() && now.getTime() < periodEnd.getTime();
  const writable =
    activeInPeriod ||
    (row.status === "trial" && !!trialEnds && trialEnds.getTime() > now.getTime()) ||
    (row.status === "canceled" && !!periodEnd && periodEnd.getTime() > now.getTime());
  const hasPaymentMethod = !!row.payment_method_id;
  // 결제일이 지났는데 아직 결과가 반영되지 않음: 카드가 있는 체험이 끝났거나, active 기간이 끝남 (스케줄러가 곧 처리)
  const awaitingPayment =
    !writable && hasPaymentMethod && ((row.status === "trial" && status === "expired") || row.status === "active");
  if (row.status === "active" && !activeInPeriod) status = "expired";
  // 해지(canceled)는 이용기간 종료 시각까지만 이용. 종료 후에는 expired(cancelled) 로 본다 (저장 상태는 sync/스케줄러가 맞춘다)
  const canceledEnded = row.status === "canceled" && !writable;
  if (canceledEnded) status = "expired";

  return {
    status,
    stored: row.status,
    writable,
    trialEndsAt: row.trial_ends_at,
    daysLeft: status === "trial" && trialEnds ? Math.max(Math.ceil((trialEnds.getTime() - now.getTime()) / DAY_MS), 0) : null,
    deniedReason: row.trial_denied_reason,
    expiredReason: row.status === "expired" ? (row.expired_reason ?? "trial_expired") : canceledEnded ? "cancelled" : null,
    hasPaymentMethod,
    periodEnd: row.current_period_end,
    awaitingPayment,
  };
}

/**
 * 서버 액션(쓰기) 최상단에서 호출한다. 체험 종료/정지 상태면 DB 에 쓰기를 시도하기 전에 대시보드로 돌려보낸다
 * (redirect 는 예외를 던져 이후 코드를 실행하지 않는다). 대시보드 상단 배너가 이유를 안내한다.
 */
export function requireWritable(state: SubscriptionState) {
  if (!state.writable) {
    redirect("/dashboard");
  }
}
