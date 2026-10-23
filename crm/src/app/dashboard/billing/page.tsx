import { format } from "date-fns";
import { requireBusinessContext } from "@/lib/business";

// 구독 설정 (결제 기능 준비 전 안내 화면, 대표 계정만).
// 정기결제 브랜치(billing/subscription-v1)의 결제 화면이 운영에 나가면 이 파일은 그 화면으로 바뀐다.
const PLANS = [
  { label: "월간 이용권", amount: "10,000원", unit: "/ 월", note: "이용기간 1개월" },
  { label: "연간 이용권", amount: "110,000원", unit: "/ 년", note: "이용기간 12개월 · 월간 대비 10,000원 절약" },
];

const fmtDate = (v: string | null | undefined) => (v ? format(new Date(v), "yyyy.MM.dd") : "-");

function statusLabel(status: string, writable: boolean, daysLeft: number | null) {
  if (status === "trial") return `무료체험 중${daysLeft !== null ? ` · ${daysLeft}일 남음` : ""}`;
  if (status === "active") return "이용 중";
  if (status === "canceled") return writable ? "해지 예정" : "해지됨 (이용 제한)";
  if (status === "suspended") return "이용 정지";
  return "이용 기간 종료 (이용 제한)";
}

export default async function BillingSettingsPage() {
  const { profile, subscription } = await requireBusinessContext();

  if (profile.role !== "owner") {
    return <p className="rounded-xl bg-card p-6 text-sm text-muted">구독 설정은 대표 계정만 확인할 수 있습니다.</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">구독 설정</h1>
        <p className="mt-1.5 text-[15px] text-muted">매니온 이용 상태와 요금제를 확인합니다.</p>
      </div>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-base font-bold text-foreground">현재 이용 상태</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[120px_1fr]">
          <dt className="text-muted">상태</dt>
          <dd className="font-semibold text-foreground" data-billing-status>
            {statusLabel(subscription.status, subscription.writable, subscription.daysLeft)}
          </dd>
          {subscription.status === "trial" && (
            <>
              <dt className="text-muted">무료체험 종료</dt>
              <dd className="text-foreground">{fmtDate(subscription.trialEndsAt)}</dd>
            </>
          )}
          <dt className="text-muted">이용 가능 기능</dt>
          <dd className="text-foreground">
            {subscription.writable ? "모든 기능 이용 가능" : "조회·내보내기만 가능 (등록·수정·삭제 제한)"}
          </dd>
        </dl>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-base font-bold text-foreground">요금제</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PLANS.map((p) => (
            <div key={p.label} className="rounded-xl border border-border p-4">
              <p className="text-sm font-semibold text-foreground">{p.label}</p>
              <p className="mt-1 text-lg font-bold text-foreground">
                {p.amount} <span className="text-xs font-medium text-muted">{p.unit} · VAT 포함</span>
              </p>
              <p className="text-xs text-muted">{p.note}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">모든 기능은 두 요금제가 같고, 결제 주기만 다릅니다.</p>
      </section>

      <section className="space-y-2 rounded-2xl border border-border bg-card p-5 sm:p-6" data-billing-notice>
        <h2 className="text-base font-bold text-foreground">결제·구독 연장·해지</h2>
        <p className="text-sm text-foreground">온라인 결제 기능은 준비 중입니다.</p>
        <p className="text-sm text-muted">
          유료 이용, 구독 연장·해지는 고객센터로 문의해주세요. 준비가 끝나면 이 화면에서 카드·계좌 자동결제와 간편결제로 직접 결제하실 수 있습니다.
        </p>
        <p className="pt-1 text-sm font-semibold text-foreground">
          고객센터 <a href="tel:01090541909" className="text-accent hover:underline">010-9054-1909</a>
          <span className="ml-2 text-xs font-normal text-muted">평일 09:00~18:00</span>
        </p>
      </section>
    </div>
  );
}
