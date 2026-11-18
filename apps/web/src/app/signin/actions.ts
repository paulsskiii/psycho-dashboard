"use server";

import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase/server";

export type SignInState = { step: "email" | "code"; email?: string; error?: string };

/** Step 1: only the owner's email may request a code. Others get the same neutral message so
 * the page doesn't confirm which address is the owner's. */
export async function sendCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!email) return { step: "email", error: "Enter your email." };
  if (email !== String(process.env.OWNER_EMAIL ?? "").toLowerCase()) {
    return { step: "email", error: "That email can't sign in to Psycho." };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) {
    const limited = /rate|too many|seconds/i.test(error.message);
    return {
      step: "email",
      email,
      error: limited
        ? "Too many codes requested. Wait a minute, then try again."
        : "Couldn't send the code. Check your connection and try again.",
    };
  }
  return { step: "code", email };
}

/** Step 2: verify the emailed code (the project sends 8 digits; 6–10 accepted) and start a
 * long-lived session. */
export async function verifyCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "");
  const token = String(form.get("code") ?? "").replace(/\D/g, "");
  if (token.length < 6) return { step: "code", email, error: "Enter the full code from the email." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { step: "code", email, error: "That code didn't work. Check it, or send a new one." };
  redirect("/");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/signin");
}
