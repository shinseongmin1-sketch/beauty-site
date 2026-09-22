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
  current_period_end: string | null;
}

export interface SubscriptionState {
  /** 저장된 값이 trial 이어도 종료 시각이 지났으면 expired 로 계산한 "실효 상태" */
  status: SubscriptionStatus;
  stored: SubscriptionStatus | "none";
  writable: boolean;
  trialEndsAt: string | null;
  daysLeft: number | null;
  deniedReason: string | null;
}

const DAY_MS = 24 * 3600 * 1000;

export function computeSubscriptionState(row: SubscriptionRow | null | undefined, now = new Date()): SubscriptionState {
  // 구독 정보가 없으면 쓰기 불가로 본다 (DB 도 동일하게 fail-closed).
  if (!row) {
    return { status: "expired", stored: "none", writable: false, trialEndsAt: null, daysLeft: null, deniedReason: null };
  }

  const trialEnds = row.trial_ends_at ? new Date(row.trial_ends_at) : null;
  const periodEnd = row.current_period_end ? new Date(row.current_period_end) : null;

  let status: SubscriptionStatus = row.status;
  if (row.status === "trial" && (!trialEnds || trialEnds.getTime() <= now.getTime())) status = "expired";

  const writable =
    row.status === "active" ||
    (row.status === "trial" && !!trialEnds && trialEnds.getTime() > now.getTime()) ||
    (row.status === "canceled" && !!periodEnd && periodEnd.getTime() > now.getTime());

  return {
    status,
    stored: row.status,
    writable,
    trialEndsAt: row.trial_ends_at,
    daysLeft: status === "trial" && trialEnds ? Math.max(Math.ceil((trialEnds.getTime() - now.getTime()) / DAY_MS), 0) : null,
    deniedReason: row.trial_denied_reason,
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
