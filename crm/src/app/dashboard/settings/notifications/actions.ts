"use server";

import { revalidatePath } from "next/cache";
import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";

export async function updateNotificationSettings(formData: FormData) {
  const { supabase, business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "settings");

  const reservationCreated = formData.get("reservation_created") === "on";
  const reservationUpdated = formData.get("reservation_updated") === "on";
  const reservationCancelled = formData.get("reservation_cancelled") === "on";
  const reservationReminder = formData.get("reservation_reminder") === "on";
  const channel = String(formData.get("channel") ?? "sms");
  const reservationCreatedMessage = String(formData.get("reservation_created_message") ?? "").trim() || null;
  const reservationUpdatedMessage = String(formData.get("reservation_updated_message") ?? "").trim() || null;
  const reservationCancelledMessage = String(formData.get("reservation_cancelled_message") ?? "").trim() || null;
  const reservationReminderMessage = String(formData.get("reservation_reminder_message") ?? "").trim() || null;
  const reservationReminderTiming = String(formData.get("reservation_reminder_timing") ?? "1day");

  await supabase
    .from("notification_settings")
    .update({
      reservation_created: reservationCreated,
      reservation_updated: reservationUpdated,
      reservation_cancelled: reservationCancelled,
      reservation_reminder: reservationReminder,
      channel,
      reservation_created_message: reservationCreatedMessage,
      reservation_updated_message: reservationUpdatedMessage,
      reservation_cancelled_message: reservationCancelledMessage,
      reservation_reminder_message: reservationReminderMessage,
      reservation_reminder_timing: reservationReminderTiming,
      updated_at: new Date().toISOString(),
    })
    .eq("business_id", business.id);

  revalidatePath("/dashboard/settings/notifications");
}
