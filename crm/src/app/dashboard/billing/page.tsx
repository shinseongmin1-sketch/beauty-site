import { format } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import { BILLING_PLANS, formatWon, isBillingCycle, type BillingCycle } from "@/lib/billing/plans";
import { CardRegisterForm } from "./card-form";
import { PayNowForm } from "./pay-now-form";
import { CancelAutoRenewalButton } from "./cancel-button";

const fmt = (v: string | null | undefined) => (v ? format(new Date(v), "yyyy.MM.dd HH:mm") : "-");
const fmtDate = (v: string | null | undefined) => (v ? format(new Date(v), "yyyy.MM.dd") : "-");

const MESSAGES: Record<string, { ok: boolean; text: string }> = {
  paid: { ok: true, text: "결제가 완료되었습니다. 지금부터 바로 이용할 수 있습니다." },
  registered: { ok: true, text: "결제수단이 등록되었습니다." },
  payment_failed: { ok: false, text: "결제에 실패했습니다. 카드 상태를 확인하거나 다른 카드로 결제해주세요." },
  payment_pending: { ok: false, text: "결제 결과를 확인하고 있습니다. 잠시 후 이 화면을 새로고침해주세요." },
  payment_in_progress: { ok: false, text: "이미 진행 중인 결제가 있습니다. 잠시 후 새로고침해주세요." },
  already_active: { ok: false, text: "현재 이용 중이라 지금 결제할 필요가 없습니다." },
  payment_method_required: { ok: false, text: "먼저 결제수단(카드)을 등록해주세요." },
  consent_required: { ok: false, text: "자동결제 안내에 동의해주세요." },
  card_register_failed: { ok: false, text: "카드 등록에 실패했습니다. 다시 시도해주세요." },
  card_register_canceled: { ok: false, text: "카드 등록이 취소되었습니다." },
  customer_mismatch: { ok: false, text: "잘못된 결제 요청입니다. 다시 시도해주세요." },
  forbidden: { ok: false, text: "대표 계정만 결제를 관리할 수 있습니다." },
  canceled: { ok: true, text: "자동결제가 해지되었습니다." },
  already_canceled: { ok: false, text: "이미 자동결제가 해지된 상태입니다." },
  not_cancellable: { ok: false, text: "해지할 자동결제가 없습니다." },
  cancel_failed: { ok: false, text: "자동결제 해지에 실패했습니다. 잠시 후 다시 시도해주세요." },
};

function labelOf(status: string, reason: string | null, awaiting: boolean) {
  if (awaiting) return "자동결제 처리 중";
  if (status === "trial") return "무료체험 중";
  if (status === "active") return "이용 중";
  if (status === "canceled") return "해지 예정";
  if (status === "suspended") return "이용 정지";
  if (reason === "payment_failed") return "결제 필요 (이용 제한)";
  if (reason === "cancelled") return "해지됨 (이용 제한)";
  return "이용 기간 종료 (이용 제한)";
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { supabase, profile, subscription } = await requireBusinessContext();
  const q = await searchParams;

  if (profile.role !== "owner") {
    return <p className="rounded-xl bg-card p-6 text-sm text-muted">구독·결제는 대표 계정만 관리할 수 있습니다.</p>;
  }

  const { data: row } = await supabase
    .from("subscriptions")
    .select("status, billing_cycle, trial_ends_at, current_period_start, current_period_end, expired_reason")
    .maybeSingle();
  const { data: cardRows } = await supabase.rpc("billing_my_payment_method");
  const card = (cardRows as { card_company: string | null; card_number_masked: string | null }[] | null)?.[0] ?? null;
  const { data: history } = await supabase
    .from("subscription_payments")
    .select("id, kind, billing_cycle, amount, supply_amount, vat_amount, status, period_start, period_end, requested_at, paid_at")
    .order("requested_at", { ascending: false })
    .limit(10);

  const cycle: BillingCycle = isBillingCycle(row?.billing_cycle) ? row.billing_cycle : "monthly";
  const blocked = !subscription.writable && !subscription.awaitingPayment;
  const cardLabel = card ? `${card.card_company ?? "카드"} ${card.card_number_masked ?? ""}`.trim() : null;
  const nextCharge =
    card && row?.status === "trial" ? row.trial_ends_at : card && row?.status === "active" ? row.current_period_end : null;
  const msgKey = q.paid ? "paid" : q.registered ? "registered" : q.canceled ? "canceled" : q.error;
  // 자동결제 해지: 이용 중(active 기간 안) 또는 카드를 등록한 체험 중일 때만 가능. 해지해도 이 종료 시각까지 이용한다.
  const usableUntil = row?.status === "trial" ? row.trial_ends_at : row?.current_period_end ?? null;
  const cancellable = subscription.writable && ((row?.status === "active") || (row?.status === "trial" && !!card));
  const canceledActive = row?.status === "canceled" && subscription.writable;
  const msg = msgKey ? (MESSAGES[msgKey] ?? { ok: false, text: "요청을 처리하지 못했습니다." }) : null;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-[26px] font-bold text-foreground">구독·결제</h1>

      {msg && (
        <p className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? "bg-status-mint-bg text-status-mint-text" : "bg-red-50 text-red-600"}`} data-billing-message={msgKey}>
          {msg.text}
        </p>
      )}

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-base font-bold text-foreground">현재 이용 상태</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[120px_1fr]">
          <dt className="text-muted">상태</dt>
          <dd className="font-semibold text-foreground" data-billing-status>
            {labelOf(row?.status ?? "expired", row?.expired_reason ?? null, subscription.awaitingPayment)}
          </dd>
          <dt className="text-muted">요금제</dt>
          <dd className="text-foreground">
            {row?.billing_cycle ? `${BILLING_PLANS[cycle].label} ${formatWon(BILLING_PLANS[cycle].amount)} (VAT 포함)` : "선택 전"}
          </dd>
          {row?.status === "trial" && (
            <>
              <dt className="text-muted">무료체험 종료</dt>
              <dd className="text-foreground">{fmt(row.trial_ends_at)}</dd>
            </>
          )}
          {row?.current_period_start && (
            <>
              <dt className="text-muted">이용기간</dt>
              <dd className="text-foreground" data-billing-period>
                {fmt(row.current_period_start)} ~ {fmt(row.current_period_end)}
              </dd>
            </>
          )}
          <dt className="text-muted">다음 결제 예정</dt>
          <dd className="text-foreground" data-next-charge>
            {nextCharge ? `${fmtDate(nextCharge)} · ${formatWon(BILLING_PLANS[cycle].amount)}` : row?.status === "canceled" ? "없음 (자동결제 해지됨)" : "-"}
          </dd>
          <dt className="text-muted">결제수단</dt>
          <dd className="text-foreground">{cardLabel ?? "등록된 카드 없음"}</dd>
        </dl>
      </section>

      {canceledActive && (
        <section className="space-y-1 rounded-2xl border border-border bg-card p-5 text-sm sm:p-6" data-canceled-notice>
          <h2 className="text-base font-bold text-foreground">자동결제가 해지되었습니다.</h2>
          <p className="text-foreground">현재 이용기간: {fmt(row?.current_period_end)}까지</p>
          <p className="text-foreground">다음 자동결제 없음</p>
          <p className="pt-1 text-muted">이용기간이 끝나면 등록·수정·삭제가 제한됩니다. 기존 데이터는 그대로 유지되며, 이후 결제하기로 다시 이용할 수 있습니다.</p>
        </section>
      )}

      {cancellable && (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-5 sm:p-6" data-auto-renewal>
          <h2 className="text-base font-bold text-foreground">자동결제</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[120px_1fr]">
            <dt className="text-muted">현재 요금제</dt>
            <dd className="text-foreground">{BILLING_PLANS[cycle].label} {formatWon(BILLING_PLANS[cycle].amount)} (VAT 포함)</dd>
            <dt className="text-muted">{row?.status === "trial" ? "무료체험 종료" : "이용기간 종료"}</dt>
            <dd className="text-foreground">{fmt(usableUntil)}</dd>
            <dt className="text-muted">다음 자동결제 예정</dt>
            <dd className="text-foreground">{nextCharge ? `${fmtDate(nextCharge)} · ${formatWon(BILLING_PLANS[cycle].amount)}` : "-"}</dd>
          </dl>
          <CancelAutoRenewalButton periodEndLabel={fmt(usableUntil)} />
        </section>
      )}

      {blocked ? (
        <section className="space-y-4 rounded-2xl border border-red-200 bg-card p-5 sm:p-6">
          <div>
            <h2 className="text-base font-bold text-foreground">결제하기</h2>
            <p className="mt-1 text-sm text-muted">
              결제가 완료되면 바로 CRM 을 다시 이용할 수 있습니다. 새 이용기간은 결제가 완료된 시각부터 시작됩니다. 기존 데이터는 그대로 유지됩니다.
            </p>
          </div>
          {cardLabel && <PayNowForm defaultCycle={cycle} cardLabel={cardLabel} />}
          <div className={cardLabel ? "border-t border-border pt-4" : ""}>
            {cardLabel && <p className="mb-3 text-sm font-semibold text-foreground">다른 카드로 결제</p>}
            <CardRegisterForm
              intent="pay"
              defaultCycle={cycle}
              submitLabel={cardLabel ? "새 카드 등록 후 결제하기" : "카드 등록 후 결제하기"}
              autoPayNotice="등록한 카드로 지금 {amount}이 결제되며,"
            />
          </div>
        </section>
      ) : canceledActive ? null : (
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div>
            <h2 className="text-base font-bold text-foreground">{cardLabel ? "결제수단 변경" : "결제수단 등록"}</h2>
            <p className="mt-1 text-sm text-muted">
              {row?.status === "trial"
                ? `무료체험 기간에는 결제되지 않습니다. 체험 종료일(${fmtDate(row.trial_ends_at)})에 선택한 요금제로 자동결제되며, 결제에 실패하면 결제일부터 이용이 제한됩니다.`
                : "다음 결제일에 선택한 요금제로 자동결제됩니다. 결제에 실패하면 결제일부터 이용이 제한됩니다."}
            </p>
          </div>
          <CardRegisterForm
            intent="register"
            defaultCycle={cycle}
            submitLabel={cardLabel ? "카드 변경하기" : "카드 등록하기"}
            autoPayNotice={row?.status === "trial" ? "무료체험 종료 후 {amount}이 결제되며," : "다음 결제일부터 {amount}이 결제되며,"}
          />
        </section>
      )}

      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="mb-3 text-base font-bold text-foreground">결제 내역</h2>
        {!history?.length ? (
          <p className="text-sm text-muted">결제 내역이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 font-medium">요청일</th>
                  <th className="py-2 font-medium">구분</th>
                  <th className="py-2 font-medium">금액 (공급가액 + 부가세)</th>
                  <th className="py-2 font-medium">상태</th>
                  <th className="py-2 font-medium">이용기간</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="border-t border-border" data-payment-status={h.status}>
                    <td className="py-2">{fmt(h.requested_at)}</td>
                    <td className="py-2">{h.kind === "auto" ? "자동결제" : "직접 결제"} · {BILLING_PLANS[h.billing_cycle as BillingCycle]?.label}</td>
                    <td className="py-2">
                      {formatWon(h.amount)} <span className="text-xs text-muted">({formatWon(h.supply_amount)} + {formatWon(h.vat_amount)})</span>
                    </td>
                    <td className="py-2">{h.status === "paid" ? "결제 완료" : h.status === "failed" ? "결제 실패" : "처리 중"}</td>
                    <td className="py-2">{h.period_start ? `${fmtDate(h.period_start)} ~ ${fmtDate(h.period_end)}` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
