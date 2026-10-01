// 토스페이먼츠 자동결제(빌링) API — 서버 전용.
// 예약 결제(lib/toss.ts, 결제위젯)와 완전히 분리: 키도 따로(TOSS_BILLING_*), 공개 테스트 키 대체값도 두지 않는다.
// 빌링키·customerKey·authKey·paymentKey 는 로그에 남기지 않는다 (오류 코드만).
const API = "https://api.tosspayments.com/v1";

function authHeader() {
  const secret = process.env.TOSS_BILLING_SECRET_KEY;
  if (!secret) throw new Error("TOSS_BILLING_SECRET_KEY 환경변수가 필요합니다.");
  return `Basic ${Buffer.from(`${secret}:`).toString("base64")}`;
}

export function billingClientKey(): string {
  const key = process.env.NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_TOSS_BILLING_CLIENT_KEY 환경변수가 필요합니다.");
  return key;
}

async function call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, idempotencyKey?: string) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    /* 비정상 응답 */
  }
  return { status: res.status, ok: res.ok, json };
}

export type IssuedBillingKey = { billingKey: string; cardCompany: string | null; cardNumberMasked: string | null; cardType: string | null };

/** 카드 등록 인증(authKey) → 빌링키 발급. customerKey 가 일치하지 않으면 토스가 거부한다. */
export async function issueBillingKey(authKey: string, customerKey: string): Promise<IssuedBillingKey> {
  const r = await call("POST", "/billing/authorizations/issue", { authKey, customerKey });
  if (!r.ok || typeof r.json.billingKey !== "string") {
    throw new Error(`billing_issue_failed:${String(r.json.code ?? r.status)}`);
  }
  const card = (r.json.card ?? {}) as Record<string, unknown>;
  return {
    billingKey: r.json.billingKey,
    cardCompany: typeof r.json.cardCompany === "string" ? r.json.cardCompany : null,
    cardNumberMasked: typeof r.json.cardNumber === "string" ? r.json.cardNumber : typeof card.number === "string" ? card.number : null,
    cardType: typeof card.cardType === "string" ? card.cardType : null,
  };
}

export type ChargeResult =
  | { outcome: "paid"; paymentKey: string; approvedAt: string | null }
  | { outcome: "failed"; code: string; message: string }
  | { outcome: "unknown"; code: string }; // 네트워크 오류/5xx/처리 중: 결과 미확정 → pending 유지, 다음 실행에서 같은 멱등키로 재확인

/**
 * 빌링키 결제. 멱등키 = 결제 기록 id (같은 결제를 다시 보내도 토스가 첫 결과를 돌려준다 → 이중 결제 없음).
 * 성공은 토스 응답의 상태·금액·주문번호가 우리가 요청한 값과 모두 같을 때만 인정한다.
 */
export async function chargeBillingKey(p: {
  billingKey: string;
  customerKey: string;
  amount: number;
  orderId: string;
  orderName: string;
  idempotencyKey: string;
}): Promise<ChargeResult> {
  let r;
  try {
    r = await call(
      "POST",
      `/billing/${encodeURIComponent(p.billingKey)}`,
      { customerKey: p.customerKey, amount: p.amount, orderId: p.orderId, orderName: p.orderName },
      p.idempotencyKey
    );
  } catch {
    return { outcome: "unknown", code: "NETWORK_ERROR" };
  }
  if (r.ok) {
    const j = r.json;
    if (j.status === "DONE" && j.totalAmount === p.amount && j.orderId === p.orderId && typeof j.paymentKey === "string") {
      return { outcome: "paid", paymentKey: j.paymentKey, approvedAt: typeof j.approvedAt === "string" ? j.approvedAt : null };
    }
    return { outcome: "failed", code: "UNEXPECTED_PAYMENT_RESULT", message: "결제 결과가 요청과 일치하지 않습니다." };
  }
  const code = String(r.json.code ?? r.status);
  if (r.status >= 500 || r.status === 409) return { outcome: "unknown", code };
  return { outcome: "failed", code, message: String(r.json.message ?? "결제에 실패했습니다.") };
}

/** 교체/해지된 빌링키 삭제. 실패해도 결제 흐름을 막지 않는다 (코드만 반환). */
export async function deleteBillingKey(billingKey: string): Promise<boolean> {
  try {
    const r = await call("DELETE", `/billing/${encodeURIComponent(billingKey)}`);
    return r.ok;
  } catch {
    return false;
  }
}

export type OrderLookup =
  | { found: true; status: string; totalAmount: number | null; paymentKey: string | null; approvedAt: string | null }
  | { found: false } // 토스에 이 주문번호의 결제 기록이 없음 (요청이 도달하지 않았거나 아직 처리 전)
  | { error: string }; // 조회 자체 실패 → 결과를 추측하지 않는다

/** 주문번호로 결제 결과 조회 (결과를 모르는 결제를 "다시 결제하지 않고" 확인할 때 쓴다) */
export async function getPaymentByOrderId(orderId: string): Promise<OrderLookup> {
  try {
    const r = await call("GET", `/payments/orders/${encodeURIComponent(orderId)}`);
    if (r.ok) {
      const j = r.json;
      return {
        found: true,
        status: String(j.status ?? ""),
        totalAmount: typeof j.totalAmount === "number" ? j.totalAmount : null,
        paymentKey: typeof j.paymentKey === "string" ? j.paymentKey : null,
        approvedAt: typeof j.approvedAt === "string" ? j.approvedAt : null,
      };
    }
    if (r.status === 404) return { found: false };
    return { error: String(r.json.code ?? r.status) };
  } catch {
    return { error: "NETWORK_ERROR" };
  }
}
