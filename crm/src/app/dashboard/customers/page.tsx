import Link from "next/link";
import { requireBusinessContext } from "@/lib/business";
import type { CustomerGrade, CustomerTag, CustomerWithMeta } from "@/lib/types";
import { addCustomer } from "./actions";
import { CustomerListClient } from "./list-client";

export default async function CustomersPage() {
  const { supabase, business } = await requireBusinessContext();

  const [{ data: customersRaw }, { data: grades }, { data: tags }] = await Promise.all([
    supabase
      .from("customers")
      .select("*, grade:customer_grades(id,name), customer_tag_links(tag:customer_tags(id,name))")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false }),
    supabase.from("customer_grades").select("*").eq("business_id", business.id).order("created_at").returns<CustomerGrade[]>(),
    supabase.from("customer_tags").select("*").eq("business_id", business.id).order("created_at").returns<CustomerTag[]>(),
  ]);

  const customers: CustomerWithMeta[] = (customersRaw ?? []).map((c: Record<string, unknown>) => ({
    ...(c as object),
    tags: ((c.customer_tag_links as { tag: { id: string; name: string } | null }[] | null) ?? [])
      .map((l) => l.tag)
      .filter((t): t is { id: string; name: string } => Boolean(t)),
  })) as CustomerWithMeta[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-bold text-foreground">고객 관리</h1>
        <div className="flex gap-2 text-sm">
          <Link href="/dashboard/customers/grades" className="rounded-xl border border-border bg-card px-3 py-2 font-medium hover:bg-background">
            등급 관리
          </Link>
          <Link href="/dashboard/customers/tags" className="rounded-xl border border-border bg-card px-3 py-2 font-medium hover:bg-background">
            태그 관리
          </Link>
        </div>
      </div>

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

      <CustomerListClient customers={customers} grades={grades ?? []} tags={tags ?? []} />
    </div>
  );
}
