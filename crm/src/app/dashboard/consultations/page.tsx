import { requireBusinessContext } from "@/lib/business";
import type { ConsultationType, ConsultationWithRelations } from "@/lib/types";
import { ConsultationListClient } from "./list-client";

export default async function ConsultationsPage() {
  const { supabase, business } = await requireBusinessContext();

  const [{ data: consultations }, { data: staff }, { data: types }] = await Promise.all([
    supabase
      .from("consultations")
      .select("*, customer:customers(id,name,phone), staff:staff(id,name,color), type_ref:consultation_types(id,name)")
      .eq("business_id", business.id)
      .order("consult_date", { ascending: false })
      .order("created_at", { ascending: false })
      .returns<ConsultationWithRelations[]>(),
    supabase.from("staff").select("id,name").eq("business_id", business.id).eq("active", true).order("name"),
    supabase.from("consultation_types").select("*").eq("business_id", business.id).order("created_at").returns<ConsultationType[]>(),
  ]);

  return <ConsultationListClient consultations={consultations ?? []} staff={staff ?? []} types={types ?? []} />;
}
