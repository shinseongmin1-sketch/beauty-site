"use client";

import { useState } from "react";
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { prepareCardRegistration } from "./actions";
import { BILLING_PLANS, formatWon, type BillingCycle } from "@/lib/billing/plans";

/**
 * 요금제 선택 + 자동결제 동의 + 토스 카드 등록창 열기.
 * intent=register: 카드만 등록(체험 중/카드 변경) / intent=pay: 등록 후 바로 직접 결제(차단 상태).
 * 금액은 화면 표시용일 뿐, 실제 결제 금액은 서버/DB 가 정한다.
 */
export function CardRegisterForm({
  intent,
  defaultCycle,
  submitLabel,
  autoPayNotice,
}: {
  intent: "register" | "pay";
  defaultCycle: BillingCycle;
  submitLabel: string;
  autoPayNotice: string;
}) {
  const [cycle, setCycle] = useState<BillingCycle>(defaultCycle);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setError(null);
    if (!consent) return setError("자동결제 안내에 동의해주세요.");
    setBusy(true);
    try {
      const prep = await prepareCardRegistration(cycle, consent);
      if (!prep.ok) {
        setError(prep.error);
        return;
      }
      const toss = await loadTossPayments(prep.clientKey);
      const payment = toss.payment({ customerKey: prep.customerKey });
      await payment.requestBillingAuth({
        method: "CARD",
        successUrl: `${window.location.origin}/dashboard/billing/card/success?cycle=${cycle}&intent=${intent}&consent=${encodeURIComponent(prep.consentVersion)}`,
        failUrl: `${window.location.origin}/dashboard/billing?error=card_register_canceled`,
        ...(prep.customerEmail ? { customerEmail: prep.customerEmail } : {}),
      });
    } catch {
      setError("카드 등록 창을 열지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <CycleChoice value={cycle} onChange={setCycle} />
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>
          {autoPayNotice.replace("{amount}", `${cycle === "monthly" ? "월" : "연"} ${formatWon(BILLING_PLANS[cycle].amount)}`)} 해지하기
          전까지 {cycle === "monthly" ? "매월" : "매년"} 같은 금액이 자동결제되는 것에 동의합니다.
        </span>
      </label>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {busy ? "카드 등록 창을 여는 중…" : submitLabel}
      </button>
    </div>
  );
}

export function CycleChoice({ value, onChange, name }: { value: BillingCycle; onChange?: (c: BillingCycle) => void; name?: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {(Object.keys(BILLING_PLANS) as BillingCycle[]).map((c) => {
        const p = BILLING_PLANS[c];
        return (
          <label
            key={c}
            className={`cursor-pointer rounded-xl border p-4 ${value === c ? "border-accent bg-accent-soft" : "border-border bg-card"}`}
          >
            <input
              type="radio"
              name={name ?? "cycle-choice"}
              value={c}
              checked={value === c}
              onChange={() => onChange?.(c)}
              className="sr-only"
            />
            <p className="text-sm font-semibold text-foreground">{p.label}</p>
            <p className="mt-1 text-lg font-bold text-foreground">
              {formatWon(p.amount)} <span className="text-xs font-medium text-muted">/ {c === "monthly" ? "월" : "년"} · VAT 포함</span>
            </p>
            <p className="text-xs text-muted">이용기간 {p.periodLabel}{c === "yearly" ? " · 월간 대비 10,000원 절약" : ""}</p>
          </label>
        );
      })}
    </div>
  );
}
