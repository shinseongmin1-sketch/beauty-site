import Link from "next/link";
import { endOfDay, endOfMonth, format, startOfDay, startOfMonth } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import type { Payment } from "@/lib/types";
import { getPaymentBadge } from "@/lib/status";
import { IconWallet, IconChart, IconClock } from "../icons";

export default async function PaymentsPage() {
  const { supabase, business } = await requireBusinessContext();

  const now = new Date();
  const todayStart = startOfDay(now).toISOString();
  const todayEnd = endOfDay(now).toISOString();
  const monthStart = startOfMonth(now).toISOString();
  const monthEnd = endOfMonth(now).toISOString();

  const [{ data }, { data: todayPaid }, { data: monthPaid }] = await Promise.all([
    supabase
      .from("payments")
      .select("*, reservation:reservations(id, customer:customers(name))")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .returns<(Payment & { reservation: { id: string; customer: { name: string } | null } | null })[]>(),
    supabase
      .from("payments")
      .select("amount")
      .eq("business_id", business.id)
      .eq("status", "paid")
      .gte("paid_at", todayStart)
      .lte("paid_at", todayEnd),
    supabase
      .from("payments")
      .select("amount")
      .eq("business_id", business.id)
      .eq("status", "paid")
      .gte("paid_at", monthStart)
      .lte("paid_at", monthEnd),
  ]);

  const payments = data ?? [];
  const todayRevenue = (todayPaid ?? []).reduce((s, p) => s + p.amount, 0);
  const monthRevenue = (monthPaid ?? []).reduce((s, p) => s + p.amount, 0);
  const paidCount = payments.filter((p) => p.status === "paid").length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">매출/통계</h1>
        <p className="mt-1.5 text-[15px] text-muted">결제 현황과 매출을 확인하세요.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard icon={<IconWallet className="h-5 w-5" />} label="오늘 매출" value={`${todayRevenue.toLocaleString()}원`} />
        <SummaryCard icon={<IconChart className="h-5 w-5" />} label="이번 달 매출" value={`${monthRevenue.toLocaleString()}원`} />
        <SummaryCard icon={<IconClock className="h-5 w-5" />} label="결제완료 건수" value={`${paidCount}건`} />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-4 font-medium">일시</th>
              <th className="p-4 font-medium">고객</th>
              <th className="p-4 font-medium">금액</th>
              <th className="p-4 font-medium">상태</th>
              <th className="p-4 font-medium">방법</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {payments.length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted">
                  결제 내역이 없습니다.
                </td>
              </tr>
            )}
            {payments.map((p) => {
              const badge = getPaymentBadge(p.status);
              return (
                <tr key={p.id}>
                  <td className="p-4 text-muted">{format(new Date(p.created_at), "yyyy-MM-dd HH:mm")}</td>
                  <td className="p-4">
                    {p.reservation ? (
                      <Link href={`/dashboard/reservations/${p.reservation.id}`} className="text-foreground hover:underline">
                        {p.reservation.customer?.name ?? "미지정"}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="p-4 font-medium text-foreground">{p.amount.toLocaleString()}원</td>
                  <td className="p-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.bg} ${badge.text}`}>
                      {badge.label}
                    </span>
                  </td>
                  <td className="p-4 text-muted">{p.method ?? "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          {icon}
        </span>
        <p className="text-sm text-muted">{label}</p>
      </div>
      <p className="mt-3 text-[26px] font-bold leading-none text-foreground">{value}</p>
    </div>
  );
}
