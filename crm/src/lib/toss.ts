// 토스페이먼츠 연동 헬퍼.
//
// 아래 TOSS_TEST_* 키는 토스페이먼츠 공식 개발자 문서(docs.tosspayments.com)에
// 누구나 사용해보라고 공개해둔 샌드박스(테스트) 키다. 실제 카드 결제 없이
// 연동 흐름을 그대로 테스트할 수 있다.
// 실서비스로 전환할 때는 반드시 .env.local 의 TOSS_CLIENT_KEY / TOSS_SECRET_KEY 를
// 토스페이먼츠 상점 심사를 마친 뒤 발급받은 실제 키로 바꿔야 한다.
export const TOSS_TEST_CLIENT_KEY = "test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq";
const TOSS_TEST_SECRET_KEY = "test_sk_zXLkKEypNArWmo50nX3lmeaxYG5R";

export function getTossClientKey(businessClientKey?: string | null) {
  return businessClientKey || process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || TOSS_TEST_CLIENT_KEY;
}

/** 토스페이먼츠 결제 승인 API 호출 (서버 전용, secret key 사용). */
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
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.message ?? "결제 승인에 실패했습니다.");
  }

  return data as { method?: string; [key: string]: unknown };
}
