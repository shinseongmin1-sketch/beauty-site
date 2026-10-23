// 토스 빌링키 발급 응답(Billing 객체) 해석 — 외부 의존 없음 (로컬 테스트에서 바로 불러 쓴다).
// 카드: card.number(마스킹), card.cardType / (옛 버전) cardCompany, cardNumber
// 계좌 자동이체(퀵계좌이체): method "계좌이체", transfers.bankName / bankCode / bankAccountNumber(마스킹)
export type BillingMethod = "card" | "transfer";
export type IssuedBillingKey = {
  billingKey: string;
  method: BillingMethod;
  cardCompany: string | null;
  cardNumberMasked: string | null;
  cardType: string | null;
  bankName: string | null;
  accountNumberMasked: string | null; // 토스가 마스킹해서 주는 계좌번호만 (원문 계좌번호는 받지 않는다)
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export function parseIssuedBillingKey(json: Record<string, unknown>): IssuedBillingKey {
  if (typeof json.billingKey !== "string" || !json.billingKey) throw new Error("billing_issue_failed:NO_BILLING_KEY");
  const card = (json.card && typeof json.card === "object" ? json.card : {}) as Record<string, unknown>;
  // transfers 는 객체 또는 배열로 올 수 있어 둘 다 받는다
  const rawTransfer = Array.isArray(json.transfers) ? json.transfers[0] : json.transfers ?? json.transfer;
  const transfer = (rawTransfer && typeof rawTransfer === "object" ? rawTransfer : {}) as Record<string, unknown>;
  const isTransfer = json.method === "계좌이체" || (!json.card && Object.keys(transfer).length > 0);
  return {
    billingKey: json.billingKey,
    method: isTransfer ? "transfer" : "card",
    cardCompany: isTransfer ? null : str(json.cardCompany),
    cardNumberMasked: isTransfer ? null : str(json.cardNumber) ?? str(card.number),
    cardType: isTransfer ? null : str(card.cardType),
    bankName: isTransfer ? str(transfer.bankName) ?? str(transfer.bankCode) : null,
    accountNumberMasked: isTransfer ? str(transfer.bankAccountNumber) : null,
  };
}
