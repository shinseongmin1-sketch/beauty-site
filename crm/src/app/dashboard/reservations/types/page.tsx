import { requireBusinessContext } from "@/lib/business";
import type { ReservationType } from "@/lib/types";
import { EntityManagerClient } from "../../entity-manager-client";
import {
  addReservationType,
  deleteReservationType,
  toggleReservationTypeActive,
  updateReservationType,
} from "./actions";

export default async function ReservationTypesPage() {
  const { supabase, business } = await requireBusinessContext();

  const { data } = await supabase
    .from("reservation_types")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at")
    .returns<ReservationType[]>();

  return (
    <EntityManagerClient
      items={data ?? []}
      withColor
      withActive
      title="예약타입"
      description="고객이 어떤 방식으로 예약했는지 매장에 맞게 직접 만들어보세요."
      addLabel="+ 예약타입 추가"
      entityLabel="타입"
      onAdd={addReservationType}
      onUpdate={updateReservationType}
      onDelete={deleteReservationType}
      onToggleActive={toggleReservationTypeActive}
    />
  );
}
