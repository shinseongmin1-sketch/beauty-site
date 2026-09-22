import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import type { CustomerGrade } from "@/lib/types";
import { EntityManagerClient } from "../../entity-manager-client";
import { addCustomerGrade, deleteCustomerGrade, updateCustomerGrade } from "./actions";

export default async function CustomerGradesPage() {
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");

  const { data } = await supabase
    .from("customer_grades")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at")
    .returns<CustomerGrade[]>();

  return (
    <EntityManagerClient
      items={(data ?? []).map((g) => ({ id: g.id, name: g.name, description: null }))}
      withDescription={false}
      title="고객등급"
      description="고객을 등급별로 구분해서 관리해보세요."
      addLabel="+ 등급 추가"
      entityLabel="등급"
      onAdd={addCustomerGrade}
      onUpdate={updateCustomerGrade}
      onDelete={deleteCustomerGrade}
    />
  );
}
