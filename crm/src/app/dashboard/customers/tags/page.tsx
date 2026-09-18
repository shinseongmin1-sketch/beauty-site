import { requireBusinessContext } from "@/lib/business";
import type { CustomerTag } from "@/lib/types";
import { EntityManagerClient } from "../../entity-manager-client";
import { addCustomerTag, deleteCustomerTag, updateCustomerTag } from "./actions";

export default async function CustomerTagsPage() {
  const { supabase, business } = await requireBusinessContext();

  const { data } = await supabase
    .from("customer_tags")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at")
    .returns<CustomerTag[]>();

  return (
    <EntityManagerClient
      items={(data ?? []).map((t) => ({ id: t.id, name: t.name, description: null }))}
      withDescription={false}
      title="고객태그"
      description="고객에게 여러 개의 태그를 붙여서 특징을 관리해보세요."
      addLabel="+ 태그 추가"
      entityLabel="태그"
      onAdd={addCustomerTag}
      onUpdate={updateCustomerTag}
      onDelete={deleteCustomerTag}
    />
  );
}
