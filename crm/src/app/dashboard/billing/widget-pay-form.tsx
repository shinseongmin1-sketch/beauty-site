"use client";

import { useEffect, useState } from "react";
import { loadPaymentWidget, ANONYMOUS, type PaymentWidgetInstance } from "@tosspayments/payment-widget-sdk";
import { prepareWidgetPayment } from "./actions";
import { CycleChoice } from "./card-form";
import { BILLING_PLANS, formatWon, type BillingCycle } from "@/lib/billing/plans";

type Order = { clientKey: string; orderId: string; orderName: string; amount: number; customerName: string | null; customerEmail: string | null };
const RENDER_TIMEOUT_MS = 15_000;

/**
 * 직접 결제(1회): 요금제 선택 → 토스 결제위젯(카드·퀵계좌이체·토스페이·카카오페이·네이버페이·페이코 등) → 결제.
 * 결제한 기간만 이용하고 자동결제되지 않는다. 금액·주문번호는 서버/DB 가 정하고, 승인도 서버가 한다.
 */
export function WidgetPayForm({ defaultCycle, note }: { defaultCycle: BillingCycle; note?: string }) {
  const [cycle, setCycle] = useState<BillingCycle>(defaultCycle);
  const [order, setOrder] = useState<Order | null>(null);
  const [widget, setWidget] = useState<PaymentWidgetInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // 요금제를 바꾸면 결제창을 새로 그린다

  async function open() {
    setError(null);
    setBusy(true);
    try {
      const prep = await prepareWidgetPayment(cycle);
      if (!prep.ok) return setError(prep.error);
      setOrder(prep);
    } catch {
      setError("결제 준비에 실패했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!order) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      try {
        const w = await loadPaymentWidget(order.clientKey, ANONYMOUS);
        if (cancelled) return;
        const methods = w.renderPaymentMethods(`#sub-widget-methods-${attempt}`, { value: order.amount });
        methods.on("ready", () => {
          if (cancelled) return;
          clearTimeout(timer);
          setReady(true);
        });
        w.renderAgreement(`#sub-widget-agreement-${attempt}`);
        setWidget(w);
        timer = setTimeout(() => {
          if (!cancelled) setError("결제창을 불러오지 못했습니다. 잠시 후 새로고침해주세요.");
        }, RENDER_TIMEOUT_MS);
      } catch {
        if (!cancelled) setError("결제창을 불러오지 못했습니다. 잠시 후 새로고침해주세요.");
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [order, attempt]);

  function changePlan() {
    setOrder(null);
    setWidget(null);
    setReady(false);
    setError(null);
    setAttempt((a) => a + 1);
  }

  async function pay() {
    if (!widget || !ready || !order) return;
    setBusy(true);
    setError(null);
    try {
      await widget.requestPayment({
        orderId: order.orderId,
        orderName: order.orderName,
        ...(order.customerName ? { customerName: order.customerName } : {}),
        ...(order.customerEmail ? { customerEmail: order.customerEmail } : {}),
        successUrl: `${window.location.origin}/dashboard/billing/widget/success`,
        failUrl: `${window.location.origin}/dashboard/billing?error=widget_canceled`,
      });
    } catch {
      setError("결제가 진행되지 않았습니다. 다시 시도해주세요.");
      setBusy(false);
    }
  }

  if (!order) {
    return (
      <div className="space-y-4" data-widget-pay>
        <CycleChoice value={cycle} onChange={setCycle} name="widget-cycle" />
        {note && <p className="text-xs text-muted">{note}</p>}
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={open}
          disabled={busy}
          className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? "결제 화면을 준비하는 중…" : `${BILLING_PLANS[cycle].label} ${formatWon(BILLING_PLANS[cycle].amount)} 결제하기`}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-widget-pay>
      <div className="flex items-center justify-between gap-3 rounded-xl bg-background px-4 py-3 text-sm">
        <span className="font-semibold text-foreground">
          {order.orderName} · {formatWon(order.amount)} <span className="text-xs font-normal text-muted">(VAT 포함)</span>
        </span>
        <button type="button" onClick={changePlan} disabled={busy} className="shrink-0 text-accent hover:underline">
          요금제 바꾸기
        </button>
      </div>
      <div id={`sub-widget-methods-${attempt}`} />
      <div id={`sub-widget-agreement-${attempt}`} />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={pay}
        disabled={!ready || busy}
        className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
      >
        {!ready ? "결제창 불러오는 중…" : busy ? "결제 진행 중…" : "결제하기"}
      </button>
    </div>
  );
}
