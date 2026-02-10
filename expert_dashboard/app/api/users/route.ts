import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { verifyAdminAuth, createUnauthorizedResponse, createForbiddenResponse } from "@/lib/authMiddleware";

// Force Node.js runtime to ensure environment variables are available
export const runtime = "nodejs";

/**
 * Admin-only API endpoint to fetch all user profiles.
 * Uses Supabase service role key to bypass RLS policies.
 * 
 * Security: This endpoint verifies admin authentication before allowing access.
 */
export async function GET(request: NextRequest) {
  // Verify admin authentication
  const authResult = await verifyAdminAuth(request);
  
  if (!authResult.authenticated) {
    console.warn('[/api/users] Unauthorized access attempt');
    return createUnauthorizedResponse(authResult.error || 'Authentication required');
  }
  
  if (!authResult.isAdmin) {
    console.warn('[/api/users] Non-admin user attempted access:', authResult.email);
    return createForbiddenResponse('Admin access required');
  }
  
  console.log('[/api/users] Admin access granted:', authResult.email);
  // Validate environment variables are present
  const hasUrl = !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!hasUrl || !hasServiceKey) {
    console.error("[/api/users] Missing environment variables:", {
      hasUrl,
      hasServiceKey,
      nodeEnv: process.env.NODE_ENV,
    });
    return NextResponse.json(
      {
        error: "Server configuration error. Missing Supabase credentials.",
      },
      { status: 500 }
    );
  }

  try {
    // Get admin client (with service role key)
    const supabaseAdmin = getSupabaseAdminClient();

    // Fetch all profiles (bypasses RLS)
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("*");

    if (error) {
      console.error("[/api/users] Supabase query error:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message || "Database query failed" },
        { 
          status: 500,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          }
        }
      );
    }

    return NextResponse.json(
      { profiles: data || [], count: data?.length || 0 }, 
      { 
        status: 200,
        headers: {
          'Cache-Control': 'private, max-age=60', // Cache for 60 seconds
          'Content-Type': 'application/json',
        }
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    console.error("[/api/users] Unexpected error:", {
      message,
      error: err,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
