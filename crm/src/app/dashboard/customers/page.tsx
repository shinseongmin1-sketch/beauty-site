import Link from "next/link";
import { requireBusinessContext } from "@/lib/business";
import type { Customer } from "@/lib/types";
import { addCustomer } from "./actions";

export default async function CustomersPage() {
  const { supabase, business } = await requireBusinessContext();

  const { data } = await supabase
    .from("customers")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .returns<Customer[]>();

  const customers = data ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-bold text-foreground">고객 관리</h1>

      <form
        action={addCustomer}
        className="grid grid-cols-1 gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-4"
      >
        <input name="name" required placeholder="이름" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <input name="phone" placeholder="연락처" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <input name="memo" placeholder="메모" className="rounded-lg border border-border px-3 py-2 text-sm" />
        <button
          type="submit"
          className="rounded-lg bg-accent hover:bg-accent-hover px-3 py-2 text-sm font-medium text-white"
        >
          + 고객 추가
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-background text-muted">
            <tr>
              <th className="p-3">이름</th>
              <th className="p-3">연락처</th>
              <th className="p-3">메모</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {customers.length === 0 && (
              <tr>
                <td colSpan={3} className="p-6 text-center text-muted">
                  등록된 고객이 없습니다.
                </td>
              </tr>
            )}
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="p-3">
                  <Link href={`/dashboard/customers/${c.id}`} className="font-medium hover:underline">
                    {c.name}
                  </Link>
                </td>
                <td className="p-3">{c.phone ?? "-"}</td>
                <td className="p-3 text-muted">{c.memo ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
