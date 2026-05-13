import { NextRequest, NextResponse } from "next/server";
import { verifyExpertOrAdminAuth, createUnauthorizedResponse, createForbiddenResponse } from "@/lib/authMiddleware";

export const runtime = "nodejs";

/**
 * Secure translation API route using Lingvanex.
 * Only accessible by authenticated experts and admins.
 * 
 * POST /api/translate
 * Body: { text: string, from: string, to: string }
 * 
 * Language codes:
 * - "en" → English
 * - "ceb" → Cebuano (Bisaya)
 */
export async function POST(request: NextRequest) {
  // Verify expert or admin authentication
  const authResult = await verifyExpertOrAdminAuth(request);

  if (!authResult.authenticated) {
    return createUnauthorizedResponse(authResult.error || "Authentication required");
  }

  if (!authResult.isExpertOrAdmin) {
    return createForbiddenResponse("Expert or Admin access required");
  }

  // Validate API key is configured
  const apiKey = process.env.LINGVANEX_API_KEY;
  if (!apiKey) {
    console.error("[/api/translate] LINGVANEX_API_KEY is not configured");
    return NextResponse.json(
      { error: "Translation service is not configured. Please set LINGVANEX_API_KEY." },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { text, from, to } = body;

    // Validate input
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    if (!from || !to) {
      return NextResponse.json({ error: "Source (from) and target (to) languages are required" }, { status: 400 });
    }

    // Map short codes to Lingvanex language codes
    const langMap: Record<string, string> = {
      en: "en",
      ceb: "ceb",
      bi: "ceb", // Alias for Bisaya
    };

    const sourceLang = langMap[from] || from;
    const targetLang = langMap[to] || to;

    // Call Lingvanex API
    const response = await fetch("https://api-b2b.backenster.com/b1/api/v3/translate", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: sourceLang,
        to: targetLang,
        data: text.trim(),
        platform: "api",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      console.error("[/api/translate] Lingvanex API error:", response.status, errorBody);
      return NextResponse.json(
        { error: `Translation service error (${response.status})` },
        { status: 502 }
      );
    }

    const result = await response.json();

    // Lingvanex returns { result: "translated text" } or { err: "error message" }
    if (result.err) {
      console.error("[/api/translate] Lingvanex returned error:", result.err);
      return NextResponse.json(
        { error: result.err || "Translation failed" },
        { status: 502 }
      );
    }

    const translatedText = result.result || "";

    return NextResponse.json(
      { translatedText, from: sourceLang, to: targetLang },
      { status: 200 }
    );
  } catch (error) {
    console.error("[/api/translate] Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Translation failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
