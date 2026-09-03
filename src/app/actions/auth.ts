"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/** Sign out, then land on `next` (used by the wrong-account invitation page). */
export async function signOutTo(formData: FormData) {
  const raw = formData.get("next");
  const next = typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/login";
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect(next);
}
