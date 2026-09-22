import { requirePlatformAdmin, formatDateTime, AUDIT_ACTOR_LABEL, UUID_RE } from "@/lib/platform-admin";

interface Log {
  seq: number;
  created_at: string;
  business_id: string | null;
  business_name: string | null;
  actor_type: string;
  action: string;
  resource_type: string;
  resource_id: string | null;
  result: string;
  metadata: Record<string, unknown>;
}

const ACTION_RE = /^[a-z_]+\.[a-z_]+$/;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; action?: string }>;
}) {
  const sp = await searchParams;
  const { supabase } = await requirePlatformAdmin();
  const business = sp.business && UUID_RE.test(sp.business) ? sp.business : "";
  const action = sp.action && ACTION_RE.test(sp.action) ? sp.action : "";

  // 감사 로그는 읽기 전용이다 (수정·삭제 기능 없음, DB 도 차단). 로그에는 개인정보가 없다.
  const { data, error } = await supabase.rpc("admin_recent_audit_logs", {
    p_business: business || null,
    p_action: action || null,
    p_limit: 100,
  });
  if (error) console.error("[admin] audit failed", error.code);
  const logs = (data ?? []) as Log[];

  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-bold text-foreground">감사 로그</h1>
      <form method="get" className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-4">
        <input name="business" defaultValue={business} placeholder="사업장 ID (선택)" className="rounded-lg border border-border px-3 py-2 font-mono text-sm sm:col-span-2" />
        <input name="action" defaultValue={action} placeholder="행위 (예: customer.delete)" className="rounded-lg border border-border px-3 py-2 font-mono text-sm" />
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover">조회</button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-3">시각</th>
              <th className="p-3">사업장</th>
              <th className="p-3">행위자</th>
              <th className="p-3">행위</th>
              <th className="p-3">대상</th>
              <th className="p-3">결과</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-muted">기록이 없습니다.</td></tr>
            )}
            {logs.map((l) => (
              <tr key={l.seq}>
                <td className="whitespace-nowrap p-3 text-muted">{formatDateTime(l.created_at)}</td>
                <td className="p-3">{l.business_name ?? (l.business_id ? "삭제된 사업장" : "-")}</td>
                <td className="p-3">{AUDIT_ACTOR_LABEL[l.actor_type] ?? l.actor_type}</td>
                <td className="p-3 font-mono text-xs">{l.action}</td>
                <td className="p-3 font-mono text-xs text-muted">{l.resource_type}{l.resource_id ? ` · ${l.resource_id.slice(0, 8)}` : ""}</td>
                <td className="p-3">{l.result === "success" ? "성공" : l.result === "failure" ? "실패" : "거부"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
