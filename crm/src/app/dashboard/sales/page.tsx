import Link from "next/link";
import { endOfDay, endOfMonth, endOfWeek, format, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import type { PaymentWithRelations } from "@/lib/types";

type Period = "today" | "week" | "month" | "custom";

function resolveRange(period: Period, from?: string, to?: string) {
  const now = new Date();
  if (period === "week") return { start: startOfWeek(now), end: endOfWeek(now) };
  if (period === "month") return { start: startOfMonth(now), end: endOfMonth(now) };
  if (period === "custom" && from && to) {
    return { start: startOfDay(new Date(`${from}T00:00:00`)), end: endOfDay(new Date(`${to}T00:00:00`)) };
  }
  return { start: startOfDay(now), end: endOfDay(now) };
}

export default async function SalesStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: Period; from?: string; to?: string }>;
}) {
  const { period = "today", from, to } = await searchParams;
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "sales");

  const { start, end } = resolveRange(period, from, to);

  const { data: payments } = await supabase
    .from("payments")
    .select(
      "*, customer:customers(id,name,phone), staff:staff(id,name), service:services(id,name), payment_method:payment_methods(id,name)"
    )
    .eq("business_id", business.id)
    .eq("status", "paid")
    .gte("paid_at", start.toISOString())
    .lte("paid_at", end.toISOString())
    .order("paid_at", { ascending: false })
    .returns<PaymentWithRelations[]>();

  const list = payments ?? [];
  const totalRevenue = list.reduce((sum, p) => sum + p.amount, 0);
  const count = list.length;
  const average = count > 0 ? Math.round(totalRevenue / count) : 0;

  const byDay = groupSum(list, (p) => format(new Date(p.paid_at ?? p.created_at), "yyyy.MM.dd"));
  const byStaff = groupSum(list, (p) => p.staff?.name ?? "미지정");
  const byService = groupSum(list, (p) => p.service?.name ?? "미지정");
  const byMethod = groupSum(list, (p) => p.payment_method?.name ?? p.method ?? "미지정");

  const periods: { key: Period; label: string }[] = [
    { key: "today", label: "오늘" },
    { key: "week", label: "이번 주" },
    { key: "month", label: "이번 달" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold text-foreground">매출현황</h1>
          <p className="mt-1.5 text-[15px] text-muted">기간별 매출 현황과 통계를 확인하세요.</p>
        </div>
        <Link
          href="/dashboard/sales/new"
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          + 매출등록
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {periods.map((p) => (
          <Link
            key={p.key}
            href={`/dashboard/sales?period=${p.key}`}
            className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors ${
              period === p.key ? "border-accent bg-accent text-white" : "border-border bg-card text-foreground hover:bg-background"
            }`}
          >
            {p.label}
          </Link>
        ))}
        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="period" value="custom" />
          <input type="date" name="from" defaultValue={from} className="rounded-xl border border-border bg-card px-3 py-2 text-sm" />
          <span className="text-muted">~</span>
          <input type="date" name="to" defaultValue={to} className="rounded-xl border border-border bg-card px-3 py-2 text-sm" />
          <button
            type="submit"
            className={`rounded-xl border px-3.5 py-2 text-sm font-medium ${
              period === "custom" ? "border-accent bg-accent text-white" : "border-border bg-card hover:bg-background"
            }`}
          >
            직접 선택
          </button>
        </form>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="총 매출" value={`${totalRevenue.toLocaleString()}원`} />
        <StatCard label="결제 건수" value={`${count}건`} />
        <StatCard label="평균 결제금액" value={`${average.toLocaleString()}원`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownTable title="일자별 매출" rows={byDay} />
        <BreakdownTable title="담당자별 매출" rows={byStaff} />
        <BreakdownTable title="서비스별 매출" rows={byService} />
        <BreakdownTable title="결제방법별 매출" rows={byMethod} />
      </div>
    </div>
  );
}

function groupSum(payments: PaymentWithRelations[], keyFn: (p: PaymentWithRelations) => string) {
  const map = new Map<string, { amount: number; count: number }>();
  for (const p of payments) {
    const key = keyFn(p);
    const entry = map.get(key) ?? { amount: 0, count: 0 };
    entry.amount += p.amount;
    entry.count += 1;
    map.set(key, entry);
  }
  return Array.from(map.entries())
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.amount - a.amount);
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-[26px] font-bold leading-none text-foreground">{value}</p>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: { label: string; amount: number; count: number }[] }) {
  return (
    <div className="rounded-2xl border border-border bg-card">
      <h2 className="border-b border-border p-4 font-semibold text-foreground">{title}</h2>
      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted">데이터가 없습니다.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between p-3.5 text-sm">
              <span className="text-foreground">{r.label}</span>
              <span className="text-muted">
                {r.amount.toLocaleString()}원 · {r.count}건
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
