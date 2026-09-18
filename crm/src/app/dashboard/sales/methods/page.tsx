import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import type { PaymentMethodEntity } from "@/lib/types";
import { EntityManagerClient } from "../../entity-manager-client";
import { addPaymentMethod, deletePaymentMethod, togglePaymentMethodActive, updatePaymentMethod } from "./actions";

export default async function PaymentMethodsPage() {
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "sales");

  const { data } = await supabase
    .from("payment_methods")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at")
    .returns<PaymentMethodEntity[]>();

  return (
    <EntityManagerClient
      items={(data ?? []).map((m) => ({ id: m.id, name: m.name, description: null, active: m.active }))}
      withDescription={false}
      withActive
      title="결제방법"
      description="카드/현금/계좌이체는 기본 제공되고, 필요한 결제방법을 직접 추가할 수 있습니다."
      addLabel="+ 결제방법 추가"
      entityLabel="결제방법"
      onAdd={addPaymentMethod}
      onUpdate={updatePaymentMethod}
      onDelete={deletePaymentMethod}
      onToggleActive={togglePaymentMethodActive}
    />
  );
}
