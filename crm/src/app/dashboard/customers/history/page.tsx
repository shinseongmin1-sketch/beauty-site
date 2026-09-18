import Link from "next/link";
import { format } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import type { Customer } from "@/lib/types";

export default async function CustomerHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const { supabase, business } = await requireBusinessContext();

  let customerQuery = supabase
    .from("customers")
    .select("*")
    .eq("business_id", business.id)
    .order("name")
    .returns<Customer[]>();

  if (q) {
    customerQuery = supabase
      .from("customers")
      .select("*")
      .eq("business_id", business.id)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .order("name")
      .returns<Customer[]>();
  }

  const [{ data: customers }, { data: reservations }, { data: consultations }] = await Promise.all([
    customerQuery,
    supabase
      .from("reservations")
      .select("customer_id,start_time,status")
      .eq("business_id", business.id)
      .not("customer_id", "is", null),
    supabase
      .from("consultations")
      .select("customer_id,consult_date")
      .eq("business_id", business.id)
      .not("customer_id", "is", null),
  ]);

  const visitStats = new Map<string, { count: number; last: string | null }>();
  for (const r of reservations ?? []) {
    if (!r.customer_id) continue;
    const stat = visitStats.get(r.customer_id) ?? { count: 0, last: null };
    if (r.status === "completed") stat.count += 1;
    if (!stat.last || r.start_time > stat.last) stat.last = r.start_time;
    visitStats.set(r.customer_id, stat);
  }

  const lastConsultByCustomer = new Map<string, string>();
  for (const c of consultations ?? []) {
    if (!c.customer_id) continue;
    const prev = lastConsultByCustomer.get(c.customer_id);
    if (!prev || c.consult_date > prev) lastConsultByCustomer.set(c.customer_id, c.consult_date);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">고객이력</h1>
        <p className="mt-1.5 text-[15px] text-muted">전체 고객의 방문/상담 이력을 한눈에 확인하세요.</p>
      </div>

      <form method="get" className="flex items-center gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="고객명 또는 연락처 검색"
          className="w-72 rounded-2xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button type="submit" className="rounded-2xl border border-border bg-card px-3 py-2 text-sm hover:bg-background">
          검색
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-4 font-medium">이름</th>
              <th className="p-4 font-medium">연락처</th>
              <th className="p-4 font-medium">방문완료 횟수</th>
              <th className="p-4 font-medium">최근 예약</th>
              <th className="p-4 font-medium">최근 상담</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(customers ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-muted">
                  고객이 없습니다.
                </td>
              </tr>
            )}
            {(customers ?? []).map((c) => {
              const stat = visitStats.get(c.id);
              const lastConsult = lastConsultByCustomer.get(c.id);
              return (
                <tr key={c.id}>
                  <td className="p-4">
                    <Link href={`/dashboard/customers/${c.id}`} className="font-medium text-foreground hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="p-4 text-muted">{c.phone ?? "-"}</td>
                  <td className="p-4 text-foreground">{stat?.count ?? 0}회</td>
                  <td className="p-4 text-muted">
                    {stat?.last ? format(new Date(stat.last), "yyyy.MM.dd HH:mm") : "-"}
                  </td>
                  <td className="p-4 text-muted">
                    {lastConsult ? format(new Date(`${lastConsult}T00:00:00`), "yyyy.MM.dd") : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
