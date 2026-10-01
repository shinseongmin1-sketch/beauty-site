// 토스페이먼츠 예약결제(결제위젯) 헬퍼 — 서버 전용.
//
// 키는 환경변수(NEXT_PUBLIC_TOSS_CLIENT_KEY / TOSS_SECRET_KEY, 매장별 client key 는 businesses.toss_client_key)에서만 읽는다.
// 코드에 기본 키(공개 테스트 키 포함)를 두지 않는다: 키가 없거나, 운영 배포에서 test_ 키이거나, client/secret 의
// test·live 가 섞여 있으면 예약결제 기능 자체를 "사용할 수 없음"으로 처리한다 (lib/payment-env.ts).
import { keyMode, usablePaymentKey } from "@/lib/payment-env";

export interface ReservationPaymentConfig {
  clientKey: string;
  secretKey: string;
  testMode: boolean;
}

/** 예약결제를 쓸 수 있으면 키 설정을, 아니면 null 을 돌려준다. */
export function reservationPaymentConfig(businessClientKey?: string | null): ReservationPaymentConfig | null {
  const secretKey = usablePaymentKey(process.env.TOSS_SECRET_KEY);
  // 매장이 자기 client key 를 넣어두었으면 그 키만 쓴다 (쓸 수 없는 키여도 공용 키로 몰래 바꾸지 않음)
  const businessKey = businessClientKey?.trim();
  const clientKey = usablePaymentKey(businessKey || process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY);
  if (!secretKey || !clientKey) return null;
  if (keyMode(secretKey) !== keyMode(clientKey)) return null;
  return { clientKey, secretKey, testMode: keyMode(secretKey) === "test" };
}

export interface ConfirmedTossPayment {
  status?: string;
  orderId?: string;
  totalAmount?: number;
  method?: string;
  [key: string]: unknown;
}

/** 토스페이먼츠 결제 승인 API 호출. amount 는 반드시 서버(DB)에 기록된 금액을 넘긴다. */
export async function confirmTossPayment(
  config: ReservationPaymentConfig,
  params: { paymentKey: string; orderId: string; amount: number }
) {
  const encodedKey = Buffer.from(`${config.secretKey}:`).toString("base64");

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
