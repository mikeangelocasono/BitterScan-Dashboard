import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getPublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    throw new Error("Missing Supabase public configuration. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.");
  }
  return { url, anonKey };
}

function getServiceConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase service role configuration. Ensure SUPABASE_SERVICE_ROLE_KEY is set on the server.");
  }
  return { url, serviceRoleKey };
}

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  const { url, anonKey } = getPublicConfig();
  if (!browserClient) {
    browserClient = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== "undefined" ? window.localStorage : undefined,
        storageKey: "sb-auth-token",
        flowType: "pkce",
      },
      global: {
        headers: {
          "x-client-info": "bitter-scan-expert-dashboard",
        },
      },
    });
  }
  return browserClient;
}

export function getSupabaseServiceRoleClient(): SupabaseClient {
  const { url, serviceRoleKey } = getServiceConfig();
  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        "x-client-info": "bitter-scan-expert-dashboard",
      },
    },
  });
}
