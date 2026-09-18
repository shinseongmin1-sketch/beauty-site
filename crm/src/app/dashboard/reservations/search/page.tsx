import { requireBusinessContext } from "@/lib/business";
import { SearchPageClient } from "./search-page-client";

export default async function ReservationSearchPage() {
  const { supabase, business } = await requireBusinessContext();

  const [{ data: customers }, { data: staff }, { data: services }, { data: groups }, { data: types }] =
    await Promise.all([
      supabase.from("customers").select("id,name,phone").eq("business_id", business.id).order("name"),
      supabase
        .from("staff")
        .select("id,name")
        .eq("business_id", business.id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("services")
        .select("id,name,duration_minutes,price")
        .eq("business_id", business.id)
        .eq("active", true)
        .order("name"),
      supabase
        .from("reservation_groups")
        .select("id,name")
        .eq("business_id", business.id)
        .eq("active", true)
        .order("created_at"),
      supabase
        .from("reservation_types")
        .select("id,name,color")
        .eq("business_id", business.id)
        .eq("active", true)
        .order("created_at"),
    ]);

  return (
    <SearchPageClient
      options={{
        customers: customers ?? [],
        staff: staff ?? [],
        services: services ?? [],
        groups: groups ?? [],
        types: types ?? [],
      }}
    />
  );
}
