import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

/** Supabase client bound to the request's cookies, for server components and
 * route handlers. Used only for the company admin auth (email/password). */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          // Server Components can't set cookies; the middleware refreshes the
          // session, so swallowing here is safe.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* called from a Server Component — ignore */
          }
        },
      },
    },
  );
}
