import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/** Refreshes the Supabase session cookie on every request and sends signed-out visitors to
 * /signin. An optimistic check only: every page also verifies the session server-side. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, headers) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
          // Never let a CDN cache a response that carries someone's session.
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
        },
      },
    },
  );
  // Supabase's default (non-editable) emails contain a link, not a code. Clicking it lands here
  // with ?code=…; exchange it for a session, then drop the code from the URL.
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    const url = request.nextUrl.clone();
    url.searchParams.delete("code");
    if (error) {
      url.pathname = "/signin";
      url.search = "?link=expired";
    }
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    response.headers.forEach((v, k) => {
      if (/^(cache-control|expires|pragma)$/i.test(k)) redirect.headers.set(k, v);
    });
    return redirect;
  }

  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;
  const open = path.startsWith("/signin") || path.startsWith("/lab");
  if (!data?.claims && !open) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|.*\\.(?:png|svg|jpg|webp|woff2)$).*)"],
};
