import Link from "next/link";
import { format } from "date-fns";
import { requireBusinessContext } from "@/lib/business";
import { PAYMENT_STATUS_LABEL, type Payment } from "@/lib/types";

export default async function PaymentsPage() {
  const { supabase, business } = await requireBusinessContext();

  const { data } = await supabase
    .from("payments")
    .select("*, reservation:reservations(id, customer:customers(name))")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .returns<(Payment & { reservation: { id: string; customer: { name: string } | null } | null })[]>();

  const payments = data ?? [];
  const totalPaid = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">결제 내역</h1>
        <p className="text-sm text-muted">누적 결제완료: {totalPaid.toLocaleString()}원</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/5 text-muted">
            <tr>
              <th className="p-3">일시</th>
              <th className="p-3">고객</th>
              <th className="p-3">금액</th>
              <th className="p-3">상태</th>
              <th className="p-3">방법</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {payments.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted">
                  결제 내역이 없습니다.
                </td>
              </tr>
            )}
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="p-3">{format(new Date(p.created_at), "yyyy-MM-dd HH:mm")}</td>
                <td className="p-3">
                  {p.reservation ? (
                    <Link href={`/dashboard/reservations/${p.reservation.id}`} className="hover:underline">
                      {p.reservation.customer?.name ?? "미지정"}
                    </Link>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="p-3">{p.amount.toLocaleString()}원</td>
                <td className="p-3">
                  <span className="rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium">
                    {PAYMENT_STATUS_LABEL[p.status]}
                  </span>
                </td>
                <td className="p-3">{p.method ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
