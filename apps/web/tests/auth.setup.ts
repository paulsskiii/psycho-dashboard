/**
 * Local-only Playwright global setup: signs the screenshot tests in as the owner.
 *
 * Uses the service-role key from apps/worker/.env (Paul's Mac only) to call Supabase's admin
 * generateLink — which sends NO email — then exchanges the hashed token for a normal session and
 * writes Playwright storage state to apps/web/.auth/state.json (gitignored, 0600). Never runs in CI
 * and never ships with the app. Paul approved this on 17 Nov 2026.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const WEB = path.resolve(__dirname, "..");
export const STATE = path.join(WEB, ".auth", "state.json");
const MAX_AGE_MS = 6 * 3600e3; // reuse a session for 6 h before minting another

function readEnv(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2]) out[m[1]!] = m[2].trim();
  }
  return out;
}

export default async function globalSetup() {
  if (existsSync(STATE) && Date.now() - statSync(STATE).mtimeMs < MAX_AGE_MS) return;

  const worker = readEnv(path.join(WEB, "..", "worker", ".env"));
  const web = readEnv(path.join(WEB, ".env.local"));
  const url = web.NEXT_PUBLIC_SUPABASE_URL;
  const anon = web.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = worker.SUPABASE_SERVICE_ROLE_KEY;
  const email = web.OWNER_EMAIL;
  if (!url || !anon || !service || !email) {
    console.warn("auth.setup: missing env; signed-in tests will be skipped");
    return;
  }

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new Error(`generateLink failed: ${error?.message ?? "no token"}`);

  const jar = new Map<string, { value: string; maxAge?: number }>();
  const client = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
      setAll: (list) => {
        for (const { name, value, options } of list) jar.set(name, { value, maxAge: options?.maxAge });
      },
    },
  });
  const v = await client.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "email" });
  if (v.error) throw new Error(`verifyOtp failed: ${v.error.message}`);

  const now = Date.now() / 1000;
  const cookies = [...jar].map(([name, c]) => ({
    name,
    value: c.value,
    domain: "localhost",
    path: "/",
    expires: c.maxAge ? now + c.maxAge : now + 3600 * 24,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }));
  mkdirSync(path.dirname(STATE), { recursive: true, mode: 0o700 });
  writeFileSync(STATE, JSON.stringify({ cookies, origins: [] }));
  chmodSync(STATE, 0o600);
}
