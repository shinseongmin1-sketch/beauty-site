// 토스페이먼츠 연동 헬퍼.
//
// 예약 결제는 토스 "결제위젯" 방식이다 → 결제위젯 연동 키(클라이언트 test_gck_/live_gck_, 시크릿 test_gsk_/live_gsk_)가 필요하다.
// API 개별 연동 키(test_ck_/test_sk_)를 넣으면 토스가 401 로 거부해 결제창이 그려지지 않는다
// ("결제 UI가 아직 렌더링되지 않았습니다", 2026-10-23 확인).
// 아래 TOSS_TEST_* 키는 토스페이먼츠 공식 개발자 문서에 공개된 결제위젯 샌드박스(테스트) 키다.
// 실제 카드 결제 없이 연동 흐름을 그대로 테스트할 수 있다 (결제 기록은 토스 문서용 상점에 남는다).
// 실서비스로 전환할 때는 반드시 .env.local 의 TOSS_CLIENT_KEY / TOSS_SECRET_KEY 를
// 토스페이먼츠 상점 심사를 마친 뒤 발급받은 실제 키로 바꿔야 한다.
export const TOSS_TEST_CLIENT_KEY = "test_gck_docs_Ovk5rk1EwkEbP0W43n07xlzm";
const TOSS_TEST_SECRET_KEY = "test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6";

/** 결제위젯용 클라이언트 키인지 (API 개별 연동 키 test_ck_ 는 결제위젯에서 쓸 수 없다) */
export function isWidgetClientKey(key: string | null | undefined): boolean {
  return /^(test|live)_gck_/.test(key ?? "");
}

export function getTossClientKey(businessClientKey?: string | null) {
  return businessClientKey || process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || TOSS_TEST_CLIENT_KEY;
}

export interface ConfirmedTossPayment {
  status?: string;
  orderId?: string;
  totalAmount?: number;
  method?: string;
  [key: string]: unknown;
}

/** 토스페이먼츠 결제 승인 API 호출 (서버 전용, secret key 사용). amount 는 반드시 서버(DB)에 기록된 금액을 넘긴다. */
export async function confirmTossPayment(params: {
  paymentKey: string;
  orderId: string;
  amount: number;
}) {
  const secretKey = process.env.TOSS_SECRET_KEY || TOSS_TEST_SECRET_KEY;
  const encodedKey = Buffer.from(`${secretKey}:`).toString("base64");

  const res = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
    method: "POST",
    headers: {
      Authorization: `Basic ${encodedKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
    cache: "no-store",
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.message ?? "결제 승인에 실패했습니다.");
  }

  return data as ConfirmedTossPayment;
}
