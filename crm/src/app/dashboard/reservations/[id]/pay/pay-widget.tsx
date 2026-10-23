"use client";

import { useEffect, useState } from "react";
import {
  loadPaymentWidget,
  ANONYMOUS,
  type PaymentWidgetInstance,
} from "@tosspayments/payment-widget-sdk";
import { createPaymentIntent } from "./actions";

// lib/toss.ts 의 isWidgetClientKey 와 같은 규칙 (클라이언트 번들에 서버 코드를 넣지 않으려고 따로 둔다)
const isWidgetClientKey = (key: string) => /^(test|live)_gck_/.test(key);
const RENDER_TIMEOUT_MS = 15_000;

export function PayWidget({
  reservationId,
  customerName,
}: {
  reservationId: string;
  customerName?: string;
}) {
  const [widget, setWidget] = useState<PaymentWidgetInstance | null>(null);
  // 결제수단 화면이 완전히 그려진 뒤에만 [결제하기]를 켠다 (그 전에 누르면 토스가 "결제 UI가 아직 렌더링되지 않았습니다" 오류)
  const [ready, setReady] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [orderInfo, setOrderInfo] = useState<{ orderId: string; orderName: string } | null>(null);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        const intent = await createPaymentIntent(reservationId);
        if (cancelled) return;

        setAmount(intent.amount);
        setOrderInfo({ orderId: intent.orderId, orderName: intent.orderName });
        setAlreadyPaid(intent.alreadyPaid);

        if (intent.alreadyPaid) return;

        if (!isWidgetClientKey(intent.clientKey)) {
          setError("결제 설정이 올바르지 않습니다 (토스 결제위젯 연동 키가 필요합니다). 고객센터에 문의해주세요.");
          return;
        }

        const paymentWidget = await loadPaymentWidget(intent.clientKey, ANONYMOUS);
        if (cancelled) return;

        const methods = paymentWidget.renderPaymentMethods("#toss-payment-methods", intent.amount);
        methods.on("ready", () => {
          if (cancelled) return;
          clearTimeout(timer);
          setReady(true);
        });
        paymentWidget.renderAgreement("#toss-agreement");
        setWidget(paymentWidget);
        timer = setTimeout(() => {
          if (!cancelled) setError("결제창을 불러오지 못했습니다. 잠시 후 새로고침해주세요. 계속되면 고객센터에 문의해주세요.");
        }, RENDER_TIMEOUT_MS);
      } catch (e) {
        setError(e instanceof Error ? e.message : "결제 준비 중 오류가 발생했습니다.");
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reservationId]);

  async function handlePay() {
    if (!widget || !ready || !orderInfo) return;
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
        disabled={!widget || !ready || submitting}
        className="w-full rounded-lg bg-accent hover:bg-accent-hover py-2.5 font-semibold text-white transition-colors disabled:opacity-50"
      >
        {widget && ready ? "결제하기" : "결제 준비 중..."}
      </button>
      <p className="text-xs text-muted">
        테스트 모드입니다. 실제 카드가 결제되지 않으며, 토스페이먼츠 테스트 카드로만 진행됩니다.
      </p>
    </div>
  );
}
