"use client";

import { useEffect, useState } from "react";
import {
  loadPaymentWidget,
  ANONYMOUS,
  type PaymentWidgetInstance,
} from "@tosspayments/payment-widget-sdk";
import { createPaymentIntent } from "./actions";

export function PayWidget({
  reservationId,
  customerName,
}: {
  reservationId: string;
  customerName?: string;
}) {
  const [widget, setWidget] = useState<PaymentWidgetInstance | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [orderInfo, setOrderInfo] = useState<{ orderId: string; orderName: string } | null>(null);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const intent = await createPaymentIntent(reservationId);
        if (cancelled) return;

        setAmount(intent.amount);
        setOrderInfo({ orderId: intent.orderId, orderName: intent.orderName });
        setAlreadyPaid(intent.alreadyPaid);

        if (intent.alreadyPaid) return;

        const paymentWidget = await loadPaymentWidget(intent.clientKey, ANONYMOUS);
        if (cancelled) return;

        paymentWidget.renderPaymentMethods("#toss-payment-methods", intent.amount);
        paymentWidget.renderAgreement("#toss-agreement");
        setWidget(paymentWidget);
      } catch (e) {
        setError(e instanceof Error ? e.message : "결제 준비 중 오류가 발생했습니다.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reservationId]);

  async function handlePay() {
    if (!widget || !orderInfo) return;
    setSubmitting(true);
    try {
      await widget.requestPayment({
        orderId: orderInfo.orderId,
        orderName: orderInfo.orderName,
        customerName,
        successUrl: `${window.location.origin}/payments/success`,
        failUrl: `${window.location.origin}/payments/fail`,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "결제 요청 중 오류가 발생했습니다.");
      setSubmitting(false);
    }
  }

  if (alreadyPaid) {
    return (
      <p className="rounded-lg bg-status-mint-bg px-4 py-3 text-sm text-status-mint-text">
        이미 결제가 완료된 예약입니다.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
      {amount !== null && (
        <p className="text-lg font-semibold">결제 금액: {amount.toLocaleString()}원</p>
      )}
      <div id="toss-payment-methods" />
      <div id="toss-agreement" />
      <button
        type="button"
        onClick={handlePay}
        disabled={!widget || submitting}
        className="w-full rounded-lg bg-accent hover:bg-accent-hover py-2.5 font-semibold text-white transition-colors disabled:opacity-50"
      >
        {widget ? "결제하기" : "결제 준비 중..."}
      </button>
      <p className="text-xs text-muted">
        테스트 모드입니다. 실제 카드가 결제되지 않으며, 토스페이먼츠 테스트 카드로만 진행됩니다.
      </p>
    </div>
  );
}
