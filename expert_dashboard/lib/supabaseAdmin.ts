import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let adminClient: SupabaseClient | null = null;

/**
 * Gets a Supabase admin client with service role key for server-side operations.
 * This client bypasses Row Level Security (RLS) policies.
 * SECURITY: This should ONLY be used in server-side code (API routes, server components).
 * NEVER expose this client or the service role key to client-side code.
 */
export function getSupabaseAdminClient(): SupabaseClient {
  // Read environment variables at runtime (not at module load)
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  // Detailed logging for debugging (only in development)
  if (process.env.NODE_ENV === "development") {
    console.log("[supabaseAdmin] Environment check:", {
      hasUrl: !!url,
      hasServiceKey: !!serviceRoleKey,
      urlLength: url?.length || 0,
      keyLength: serviceRoleKey?.length || 0,
    });
  }

  // Validate configuration
  if (!url) {
    throw new Error(
      "Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL. Please set one of these environment variables."
    );
  }

  if (!serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. This must be set as a server-only environment variable (not prefixed with NEXT_PUBLIC_)."
    );
  }

  // Create singleton client instance
  if (!adminClient) {
    adminClient = createClient(url, serviceRoleKey, {
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

  return adminClient;
}

/**
 * Lazy-initialized Supabase admin client.
 * Uses a getter to ensure the client is only created at runtime (not at build/import time).
 * This prevents build failures on Vercel when environment variables aren't available during build.
 */
export const supabaseAdmin = {
  from: (table: string) => getSupabaseAdminClient().from(table),
  auth: {
    get admin() {
      return getSupabaseAdminClient().auth.admin;
    },
  },
  storage: {
    from: (bucket: string) => getSupabaseAdminClient().storage.from(bucket),
  },
  rpc: (fn: string, params?: Record<string, unknown>) => getSupabaseAdminClient().rpc(fn, params),
};
