import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { verifyAuth, createUnauthorizedResponse } from "@/lib/authMiddleware";

// Force Node.js runtime to ensure environment variables are available
export const runtime = "nodejs";

/**
 * Notification Reads API — persistent read/unread state management.
 *
 * Uses the admin (service-role) Supabase client to bypass RLS,
 * eliminating client-side auth timing issues that can cause reads
 * to silently fail and reset on refresh.
 *
 * Database table: notification_reads
 *
 *   CREATE TABLE IF NOT EXISTS notification_reads (
 *     user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 *     read_scan_ids JSONB NOT NULL DEFAULT '[]',
 *     read_user_ids JSONB NOT NULL DEFAULT '[]',
 *     updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 *   ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Users manage own reads"
 *     ON notification_reads FOR ALL
 *     USING  (auth.uid() = user_id)
 *     WITH CHECK (auth.uid() = user_id);
 */

// ─── GET: Fetch read state for the authenticated user ────────────────────
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth.authenticated || !auth.userId) {
    return createUnauthorizedResponse(auth.error || "Authentication required");
  }

  try {
    const admin = getSupabaseAdminClient();
    const { data, error } = await admin
      .from("notification_reads")
      .select("read_scan_ids, read_user_ids")
      .eq("user_id", auth.userId)
      .maybeSingle();

    if (error) {
      // 42P01 = relation does not exist (table not created yet)
      if (error.code === "42P01") {
        console.warn(
          "[/api/notifications/reads] notification_reads table does not exist. " +
          "Run the CREATE TABLE migration in Supabase SQL editor."
        );
        return NextResponse.json(
          { read_scan_ids: [], read_user_ids: [], _tableMissing: true },
          { status: 200, headers: { "Cache-Control": "no-store" } }
        );
      }
      console.error("[/api/notifications/reads] GET error:", error.message, error.code);
      return NextResponse.json(
        { read_scan_ids: [], read_user_ids: [] },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        read_scan_ids: data?.read_scan_ids ?? [],
        read_user_ids: data?.read_user_ids ?? [],
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[/api/notifications/reads] Unexpected GET error:", err);
    return NextResponse.json(
      { read_scan_ids: [], read_user_ids: [] },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }
}

// ─── PATCH: Upsert read state for the authenticated user ─────────────────
export async function PATCH(request: NextRequest) {
  const auth = await verifyAuth(request);
  if (!auth.authenticated || !auth.userId) {
    return createUnauthorizedResponse(auth.error || "Authentication required");
  }

  try {
    const body = await request.json();
    const { read_scan_ids, read_user_ids } = body;

    if (!Array.isArray(read_scan_ids) || !Array.isArray(read_user_ids)) {
      return NextResponse.json(
        { error: "read_scan_ids and read_user_ids must be arrays" },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdminClient();
    const { error } = await admin.from("notification_reads").upsert(
      {
        user_id: auth.userId,
        read_scan_ids,
        read_user_ids,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) {
      if (error.code === "42P01") {
        console.warn(
          "[/api/notifications/reads] notification_reads table does not exist. " +
          "Run the CREATE TABLE migration in Supabase SQL editor."
        );
        return NextResponse.json(
          { error: "Table not found", _tableMissing: true },
          { status: 503 }
        );
      }
      console.error("[/api/notifications/reads] PATCH error:", error.message, error.code);
      return NextResponse.json(
        { error: "Failed to save notification read state" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("[/api/notifications/reads] Unexpected PATCH error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
