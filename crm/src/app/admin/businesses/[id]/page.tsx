import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin, formatDateTime, SUBSCRIPTION_STATUS_LABEL, UUID_RE } from "@/lib/platform-admin";

interface Detail {
  id: string;
  name: string;
  representative_name: string | null;
  business_number_masked: string | null;
  created_at: string;
  status: string;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  trial_denied_reason: string | null;
  staff_count: number;
  customer_count: number;
  reservation_count: number;
  payment_count: number;
  last_activity_at: string | null;
}

const DENIED: Record<string, string> = {
  business_number_used: "이미 무료체험을 이용한 사업자번호",
  phone_limit: "같은 전화번호의 무료체험 한도 초과",
};

export default async function AdminBusinessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { supabase } = await requirePlatformAdmin();

  // 상세 열람은 DB 함수가 감사 로그(platform.business_view)로 기록한다.
  const { data, error } = await supabase.rpc("admin_business_detail", { p_business: id });
  if (error?.code === "P0002") notFound();
  if (error || !data) {
    console.error("[admin] detail failed", error?.code);
    return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">사업장 정보를 불러오지 못했습니다.</p>;
  }
  const b = data as Detail;

  const info: [string, string][] = [
    ["대표자명", b.representative_name ?? "-"],
    ["사업자등록번호", b.business_number_masked ?? "미등록"],
    ["가입일", formatDateTime(b.created_at)],
    ["현재 상태", SUBSCRIPTION_STATUS_LABEL[b.status] ?? b.status],
    ["무료체험 시작", formatDateTime(b.trial_started_at)],
    ["무료체험 종료", formatDateTime(b.trial_ends_at)],
    ["마지막 활동", formatDateTime(b.last_activity_at)],
  ];
  if (b.trial_denied_reason) info.splice(4, 0, ["무료체험 거부 사유", DENIED[b.trial_denied_reason] ?? b.trial_denied_reason]);

  const counts: [string, number][] = [
    ["등록된 직원(담당자)", b.staff_count],
    ["고객 수", b.customer_count],
    ["예약 수", b.reservation_count],
    ["매출 건수", b.payment_count],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/businesses" className="text-sm text-accent hover:underline">← 사업장 목록</Link>
        <h1 className="mt-2 text-[26px] font-bold text-foreground">{b.name}</h1>
        <p className="mt-1 text-xs text-muted">
          건수만 표시됩니다. 고객·직원의 이름/연락처 등 개인정보는 운영자 화면에 표시되지 않으며, 이 화면을 연 기록은 감사 로그에 남습니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {counts.map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm text-muted">{label}</p>
            <p className="mt-2 text-[26px] font-bold text-foreground" data-count={label}>{value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-border bg-card p-6">
        <h2 className="mb-4 text-[15px] font-bold text-foreground">기본 정보</h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {info.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-border pb-2">
              <dt className="text-muted">{k}</dt>
              <dd className="font-medium text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Link href={`/admin/audit?business=${b.id}`} className="inline-block rounded-lg border border-border px-4 py-2 text-sm hover:bg-background">
        이 사업장의 감사 로그 보기
      </Link>
    </div>
  );
}
