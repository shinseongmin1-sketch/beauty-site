import Link from "next/link";
import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import type { PaymentWithRelations } from "@/lib/types";
import { SalesHistoryClient } from "./list-client";

export default async function SalesHistoryPage() {
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "sales");

  const [{ data: payments }, { data: staff }, { data: methods }] = await Promise.all([
    supabase
      .from("payments")
      .select(
        "*, customer:customers(id,name,phone), staff:staff(id,name), service:services(id,name), payment_method:payment_methods(id,name)"
      )
      .eq("business_id", business.id)
      .eq("status", "paid")
      .order("paid_at", { ascending: false })
      .returns<PaymentWithRelations[]>(),
    supabase.from("staff").select("id,name").eq("business_id", business.id).eq("active", true).order("name"),
    supabase.from("payment_methods").select("id,name").eq("business_id", business.id).order("created_at"),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold text-foreground">매출내역</h1>
          <p className="mt-1.5 text-[15px] text-muted">기간·고객·담당자·결제방법으로 매출 내역을 검색하세요.</p>
        </div>
        <Link
          href="/dashboard/sales/new"
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          + 매출등록
        </Link>
      </div>

      <SalesHistoryClient payments={payments ?? []} staff={staff ?? []} methods={methods ?? []} />
    </div>
  );
}
