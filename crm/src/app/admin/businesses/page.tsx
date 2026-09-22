import Link from "next/link";
import { requirePlatformAdmin, formatDate, SUBSCRIPTION_STATUS_LABEL } from "@/lib/platform-admin";

const PAGE_SIZE = 25;
const STATUS_OPTIONS = ["trial", "expired", "active", "canceled", "suspended"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Row {
  id: string;
  name: string;
  representative_name: string | null;
  created_at: string;
  status: string;
  trial_ends_at: string | null;
  total_count: number;
}

export default async function AdminBusinessesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const { supabase } = await requirePlatformAdmin();

  const q = (sp.q ?? "").trim().slice(0, 100);
  const status = STATUS_OPTIONS.includes(sp.status as (typeof STATUS_OPTIONS)[number]) ? sp.status! : "";
  const from = sp.from && DATE_RE.test(sp.from) ? sp.from : "";
  const to = sp.to && DATE_RE.test(sp.to) ? sp.to : "";
  const page = Math.max(Number.parseInt(sp.page ?? "1", 10) || 1, 1);

  // 사업자등록번호는 검색 대상이 아니다 (이름/대표자명만). DB 함수도 번호 검색을 지원하지 않는다.
  const { data, error } = await supabase.rpc("admin_list_businesses", {
    p_query: q || null,
    p_status: status || null,
    p_from: from || null,
    p_to: to || null,
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (error) console.error("[admin] list failed", error.code);
  const rows = (data ?? []) as Row[];
  const total = rows[0]?.total_count ?? 0;
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (q) u.set("q", q);
    if (status) u.set("status", status);
    if (from) u.set("from", from);
    if (to) u.set("to", to);
    u.set("page", String(p));
    return `/admin/businesses?${u.toString()}`;
  };

  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-bold text-foreground">사업장</h1>

      <form method="get" className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-5">
        <input name="q" defaultValue={q} placeholder="사업장명 / 대표자명" className="rounded-lg border border-border px-3 py-2 text-sm sm:col-span-2" />
        <select name="status" defaultValue={status} className="rounded-lg border border-border px-3 py-2 text-sm">
          <option value="">전체 상태</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{SUBSCRIPTION_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={from} aria-label="가입일 시작" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <input type="date" name="to" defaultValue={to} aria-label="가입일 끝" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover sm:col-span-5 sm:w-fit">검색</button>
      </form>
      <p className="-mt-3 text-xs text-muted">사업자등록번호는 검색할 수 없습니다.</p>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-3">사업장명</th>
              <th className="p-3">대표자명</th>
              <th className="p-3">가입일</th>
              <th className="p-3">구독 상태</th>
              <th className="p-3">체험 종료일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted">검색 결과가 없습니다.</td></tr>
            )}
            {rows.map((b) => (
              <tr key={b.id}>
                <td className="p-3"><Link href={`/admin/businesses/${b.id}`} className="font-medium text-accent hover:underline">{b.name}</Link></td>
                <td className="p-3">{b.representative_name ?? "-"}</td>
                <td className="p-3 text-muted">{formatDate(b.created_at)}</td>
                <td className="p-3">{SUBSCRIPTION_STATUS_LABEL[b.status] ?? b.status}</td>
                <td className="p-3 text-muted">{formatDate(b.trial_ends_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted">
        <span>총 {Number(total).toLocaleString()}곳 · {page}/{pages} 페이지</span>
        <div className="flex gap-3">
          {page > 1 && <Link href={qs(page - 1)} className="text-accent hover:underline">이전</Link>}
          {page < pages && <Link href={qs(page + 1)} className="text-accent hover:underline">다음</Link>}
        </div>
      </div>
    </div>
  );
}
