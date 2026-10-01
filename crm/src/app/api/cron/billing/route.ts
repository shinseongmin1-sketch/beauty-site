// 구독 자동결제 스케줄러 (Vercel Cron, 하루 1회). 결제일에 1회만 시도하고 자동 재시도는 하지 않는다. 해지(canceled) 구독은 결제하지 않는다.
//   성공 → 이전 기간에 이어서 연장 / 실패 → 즉시 expired(payment_failed) / 결과 미확정 → pending 유지 후 다음 실행에서 같은 멱등키로 재확인
// Vercel Cron 은 Authorization: Bearer ${CRON_SECRET} 를 붙여 호출한다. 그 외 요청은 거부한다.
import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processCharge, reconcilePendingManual, type ChargeRow } from "@/lib/billing/charge";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });

  const admin = await createAdminClient();
  // 해지(canceled) 후 이용기간이 끝난 구독을 먼저 expired(cancelled) 로 정리한다. 해지 구독은 결제 대상(trial/active)이 아니다.
  const { error: expireError } = await admin.rpc("expire_ended_cancellations", {});
  if (expireError) console.error("[cron/billing] expire cancellations failed", expireError.code);
  const { data, error } = await admin.rpc("billing_claim_due", { p_limit: 50 });
  if (error) {
    console.error("[cron/billing] claim failed", error.code);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const summary = { claimed: 0, paid: 0, failed: 0, unknown: 0 };
  for (const row of (data ?? []) as ChargeRow[]) {
    summary.claimed++;
    const r = await processCharge(admin, row);
    summary[r.outcome === "paid" ? "paid" : r.outcome === "failed" ? "failed" : "unknown"]++;
  }
  // 결과를 모르는 직접 결제(pending)를 주문번호 조회로 확정 (재결제 요청 없음)
  const manual = await reconcilePendingManual(admin, null);
  return NextResponse.json({ ok: true, ...summary, manualResolved: manual.resolved, manualPending: manual.pending });
}
