// 매니온 구독 가격 (VAT 포함 최종 결제금액). DB 의 billing_price() / subscription_payments CHECK 와 같은 값이어야 한다.
// 결제 금액은 브라우저 값을 쓰지 않고 항상 서버/DB 기준값으로 정한다.
export type BillingCycle = "monthly" | "yearly";

export const BILLING_PLANS: Record<BillingCycle, { label: string; amount: number; supply: number; vat: number; periodLabel: string }> = {
  monthly: { label: "월간 이용권", amount: 10000, supply: 9091, vat: 909, periodLabel: "1개월" },
  yearly: { label: "연간 이용권", amount: 110000, supply: 100000, vat: 10000, periodLabel: "12개월" },
};

export const isBillingCycle = (v: unknown): v is BillingCycle => v === "monthly" || v === "yearly";

export const formatWon = (n: number) => `${n.toLocaleString("ko-KR")}원`;
