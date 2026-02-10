import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { verifyExpertOrAdminAuth, createUnauthorizedResponse, createForbiddenResponse } from "@/lib/authMiddleware";

// Force Node.js runtime to ensure environment variables are available
export const runtime = "nodejs";

/**
 * Expert/Admin API endpoint to fetch all scans.
 * Uses Supabase service role key to bypass RLS policies.
 * 
 * Security: This endpoint verifies expert or admin authentication before allowing access.
 */
export async function GET(request: NextRequest) {
  // Verify expert or admin authentication
  const authResult = await verifyExpertOrAdminAuth(request);
  
  if (!authResult.authenticated) {
    console.warn('[/api/scans] Unauthorized access attempt');
    return createUnauthorizedResponse(authResult.error || 'Authentication required');
  }
  
  if (!authResult.isExpertOrAdmin) {
    console.warn('[/api/scans] Non-expert/admin user attempted access:', authResult.email, 'role:', authResult.role);
    return createForbiddenResponse('Expert or Admin access required');
  }
  
  console.log('[/api/scans] Access granted:', authResult.email, 'role:', authResult.role);
  
  // Validate environment variables are present
  const hasUrl = !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const hasServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!hasUrl || !hasServiceKey) {
    console.error("[/api/scans] Missing environment variables:", {
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

    // Fetch leaf disease scans
    const { data: leafScans, error: leafError } = await supabaseAdmin
      .from("leaf_disease_scans")
      .select("*")
      .order("created_at", { ascending: false });

    if (leafError) {
      console.error("[/api/scans] Error fetching leaf_disease_scans:", leafError);
    }

    // Fetch fruit ripeness scans
    const { data: fruitScans, error: fruitError } = await supabaseAdmin
      .from("fruit_ripeness_scans")
      .select("*")
      .order("created_at", { ascending: false });

    if (fruitError) {
      console.error("[/api/scans] Error fetching fruit_ripeness_scans:", fruitError);
    }

    // Fetch validation history
    const { data: validationHistory, error: validationError } = await supabaseAdmin
      .from("validation_history")
      .select("*")
      .order("validated_at", { ascending: false });

    if (validationError) {
      console.error("[/api/scans] Error fetching validation_history:", validationError);
    }

    // Get all farmer IDs for profile enrichment
    const farmerIds = new Set<string>();
    (leafScans || []).forEach((scan) => {
      if (scan.farmer_id) farmerIds.add(scan.farmer_id);
    });
    (fruitScans || []).forEach((scan) => {
      if (scan.farmer_id) farmerIds.add(scan.farmer_id);
    });

    // Get all expert IDs from validation history
    const expertIds = new Set<string>();
    (validationHistory || []).forEach((validation) => {
      if (validation.expert_id) expertIds.add(validation.expert_id);
    });

    // Fetch all relevant profiles in one query
    const allUserIds = new Set([...farmerIds, ...expertIds]);
    let profilesMap = new Map<string, Record<string, unknown>>();
    
    if (allUserIds.size > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, username, full_name, email, profile_picture, role")
        .in("id", Array.from(allUserIds));
      
      if (profiles) {
        profiles.forEach((profile) => {
          profilesMap.set(profile.id, profile);
        });
      }
    }

    // Transform leaf scans
    const transformedLeafScans = (leafScans || []).map((scan) => ({
      ...scan,
      scan_type: 'leaf_disease' as const,
      ai_prediction: scan.disease_detected,
      solution: scan.solution,
      recommended_products: scan.recommendation,
      farmer_profile: scan.farmer_id ? profilesMap.get(scan.farmer_id) : undefined,
    }));

    // Transform fruit scans
    const transformedFruitScans = (fruitScans || []).map((scan) => ({
      ...scan,
      scan_type: 'fruit_maturity' as const,
      ai_prediction: scan.ripeness_stage,
      solution: scan.harvest_recommendation,
      recommended_products: undefined,
      farmer_profile: scan.farmer_id ? profilesMap.get(scan.farmer_id) : undefined,
    }));

    // Merge and sort by created_at descending
    const allScans = [...transformedLeafScans, ...transformedFruitScans].sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateB - dateA;
    });

    // Transform validation history with scan and expert profile data
    const transformedValidations = (validationHistory || []).map((validation) => {
      const scanUuid = String(validation.scan_id).trim();
      const relatedScan = allScans.find((s) => s.scan_uuid === scanUuid);
      const expertProfile = validation.expert_id ? profilesMap.get(validation.expert_id) : undefined;
      return {
        ...validation,
        scan: relatedScan || undefined,
        expert_profile: expertProfile,
      };
    });

    return NextResponse.json(
      { 
        scans: allScans, 
        validationHistory: transformedValidations,
        count: allScans.length,
        validationCount: transformedValidations.length,
      }, 
      { 
        status: 200,
        headers: {
          'Cache-Control': 'private, max-age=30', // Cache for 30 seconds
          'Content-Type': 'application/json',
        }
      }
    );
  } catch (error) {
    console.error("[/api/scans] Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to fetch scans: ${errorMessage}` },
      { 
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        }
      }
    );
  }
}
