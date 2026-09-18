import { requireBusinessContext } from "@/lib/business";
import type { ReservationGroup } from "@/lib/types";
import { EntityManagerClient } from "../../entity-manager-client";
import {
  addReservationGroup,
  deleteReservationGroup,
  toggleReservationGroupActive,
  updateReservationGroup,
} from "./actions";

export default async function ReservationGroupsPage() {
  const { supabase, business } = await requireBusinessContext();

  const { data } = await supabase
    .from("reservation_groups")
    .select("*")
    .eq("business_id", business.id)
    .order("created_at")
    .returns<ReservationGroup[]>();

  return (
    <EntityManagerClient
      items={data ?? []}
      withActive
      title="예약그룹"
      description="예약을 관리하기 위한 그룹을 자유롭게 만들어보세요. 시스템이 기본 그룹을 제공하지 않으니, 매장에 필요한 그룹을 직접 추가하세요."
      addLabel="+ 예약그룹 추가"
      entityLabel="그룹"
      onAdd={addReservationGroup}
      onUpdate={updateReservationGroup}
      onDelete={deleteReservationGroup}
      onToggleActive={toggleReservationGroupActive}
    />
  );
}
