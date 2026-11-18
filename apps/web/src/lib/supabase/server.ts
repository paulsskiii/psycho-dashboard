import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Per-request Supabase client for Server Components and Server Actions. Reads go through RLS as
 * the signed-in owner; this app never holds the service-role key. */
export async function supabaseServer() {
  const jar = await cookies();
  return createServerClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // Server Components can't set cookies; the proxy refreshes the session instead.
        }
      },
    },
  });
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. See apps/web/.env.example.`);
  return v;
}
