import "server-only";

import { redirect } from "next/navigation";

import { supabaseServer } from "./supabase/server";

/** Verified server-side on every page (the proxy check is only optimistic). */
export async function requireOwner() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getClaims();
  const email = String(data?.claims?.email ?? "").toLowerCase();
  if (!data?.claims || email !== String(process.env.OWNER_EMAIL ?? "").toLowerCase()) redirect("/signin");
  return supabase;
}
