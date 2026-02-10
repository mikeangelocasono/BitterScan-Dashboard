import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { verifyAdminAuth, createUnauthorizedResponse, createForbiddenResponse } from "@/lib/authMiddleware";

// Force Node.js runtime to ensure environment variables are available
export const runtime = "nodejs";

/**
 * Admin-only API endpoint to approve a user.
 * Uses Supabase service role key to bypass RLS policies.
 * Security: This endpoint verifies admin authentication before allowing access.
 */
export async function POST(request: NextRequest) {
  // Verify admin authentication
  const authResult = await verifyAdminAuth(request);
  
  if (!authResult.authenticated) {
    console.warn('[/api/users/approve] Unauthorized access attempt');
    return createUnauthorizedResponse(authResult.error || 'Authentication required');
  }
  
  if (!authResult.isAdmin) {
    console.warn('[/api/users/approve] Non-admin user attempted access:', authResult.email);
    return createForbiddenResponse('Admin access required');
  }
  
  console.log('[/api/users/approve] Admin action by:', authResult.email);
  
  try {
    // Parse and validate request body
    let body;
    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { userId } = body;

    // Validate userId
    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId parameter" },
        { status: 400 }
      );
    }

    if (typeof userId !== "string") {
      return NextResponse.json(
        { error: "Invalid userId format. Expected string." },
        { status: 400 }
      );
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return NextResponse.json(
        { error: "Invalid userId format. Expected UUID." },
        { status: 400 }
      );
    }

    // Get admin client (with service role key)
    const supabaseAdmin = getSupabaseAdminClient();

    // Update user status (bypasses RLS)
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update({ status: "approved" })
      .eq("id", userId)
      .in("role", ["expert", "farmer"])
      .select()
      .single();

    if (error) {
      console.error("[/api/users/approve] Supabase update error:", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });
      return NextResponse.json(
        { error: error.message || "Failed to approve user" },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "User not found or already approved" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { 
        success: true, 
        profile: data,
        message: "User approved successfully"
      }, 
      { 
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        }
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    console.error("[/api/users/approve] Unexpected error:", {
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
