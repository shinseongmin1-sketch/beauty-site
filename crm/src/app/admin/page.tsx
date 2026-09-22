import Link from "next/link";
import { requirePlatformAdmin, formatDate, formatDateTime, SUBSCRIPTION_STATUS_LABEL } from "@/lib/platform-admin";

interface Dashboard {
  total: number;
  trial: number;
  expired: number;
  expired_denied: number;
  active: number;
  canceled: number;
  suspended: number;
  recent_signups: { id: string; name: string; created_at: string; status: string }[];
  recent_trial_starts: { id: string; name: string; trial_started_at: string }[];
  recent_trial_ends: { id: string; name: string; trial_ends_at: string }[];
  recent_inquiries: { id: string; title: string; category: string; status: string; created_at: string; business_id: string | null }[];
}

const INQUIRY_STATUS: Record<string, string> = { open: "답변 대기", answered: "답변 완료", closed: "종료" };

export default async function AdminDashboardPage() {
  const { supabase } = await requirePlatformAdmin();
  const { data, error } = await supabase.rpc("admin_dashboard");
  if (error || !data) {
    console.error("[admin] dashboard failed", error?.code);
    return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">운영 현황을 불러오지 못했습니다.</p>;
  }
  const d = data as Dashboard;

  const stats: { label: string; value: number; hint?: string }[] = [
    { label: "전체 사업장", value: d.total },
    { label: "무료체험 중", value: d.trial },
    { label: "체험 종료", value: d.expired, hint: `체험 거부 ${d.expired_denied}곳 포함` },
    { label: "유료 이용", value: d.active },
    { label: "이용 정지", value: d.suspended },
    { label: "해지", value: d.canceled },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">운영 현황</h1>
        <p className="mt-1 text-sm text-muted">
          집계와 사업장 단위 정보만 표시됩니다. 매장의 고객 명단·전화번호 등 개인정보는 운영자 화면에 표시되지 않습니다.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm text-muted">{s.label}</p>
            <p className="mt-2 text-[28px] font-bold text-foreground" data-stat={s.label}>{s.value.toLocaleString()}</p>
            {s.hint && <p className="mt-1 text-xs text-muted">{s.hint}</p>}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="최근 가입 사업장" empty={d.recent_signups.length === 0}>
          {d.recent_signups.map((b) => (
            <Row key={b.id} href={`/admin/businesses/${b.id}`} title={b.name} meta={formatDateTime(b.created_at)} badge={SUBSCRIPTION_STATUS_LABEL[b.status] ?? b.status} />
          ))}
        </Panel>
        <Panel title="최근 무료체험 시작" empty={d.recent_trial_starts.length === 0}>
          {d.recent_trial_starts.map((b) => (
            <Row key={b.id} href={`/admin/businesses/${b.id}`} title={b.name} meta={formatDateTime(b.trial_started_at)} />
          ))}
        </Panel>
        <Panel title="최근 무료체험 종료" empty={d.recent_trial_ends.length === 0}>
          {d.recent_trial_ends.map((b) => (
            <Row key={b.id} href={`/admin/businesses/${b.id}`} title={b.name} meta={formatDate(b.trial_ends_at)} />
          ))}
        </Panel>
        <Panel title="최근 문의" empty={d.recent_inquiries.length === 0}>
          {d.recent_inquiries.map((i) => (
            <Row
              key={i.id}
              href={i.business_id ? `/admin/businesses/${i.business_id}` : undefined}
              title={i.title}
              meta={formatDateTime(i.created_at)}
              badge={INQUIRY_STATUS[i.status] ?? i.status}
            />
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-3 text-[15px] font-bold text-foreground">{title}</h2>
      {empty ? <p className="py-4 text-center text-sm text-muted">내역이 없습니다.</p> : <ul className="divide-y divide-border">{children}</ul>}
    </section>
  );
}

function Row({ href, title, meta, badge }: { href?: string; title: string; meta: string; badge?: string }) {
  const inner = (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="min-w-0 truncate font-medium text-foreground">{title}</span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
        {badge && <span className="rounded-full bg-status-gray-bg px-2 py-0.5 font-semibold text-status-gray-text">{badge}</span>}
        {meta}
      </span>
    </div>
  );
  return <li>{href ? <Link href={href} className="block hover:bg-background">{inner}</Link> : inner}</li>;
}
