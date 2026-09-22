import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import type { ConsultationType } from "@/lib/types";
import { EntityManagerClient } from "../../entity-manager-client";
import {
  addConsultationType,
  deleteConsultationType,
  toggleConsultationTypeActive,
  updateConsultationType,
} from "./actions";

export default async function ConsultationTypesPage() {
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "catalogs");

  const { data } = await supabase
    .from("consultation_types")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at")
    .returns<ConsultationType[]>();

  return (
    <EntityManagerClient
      items={data ?? []}
      withActive
      title="상담유형"
      description="상담 내용을 구분하기 위한 유형을 매장에 맞게 직접 만들어보세요."
      addLabel="+ 상담유형 추가"
      entityLabel="유형"
      onAdd={addConsultationType}
      onUpdate={updateConsultationType}
      onDelete={deleteConsultationType}
      onToggleActive={toggleConsultationTypeActive}
    />
  );
}
