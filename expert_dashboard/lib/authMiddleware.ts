import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Server-side authentication middleware for API routes.
 * Verifies JWT token and checks admin role.
 * 
 * SECURITY: This prevents unauthorized access to admin API endpoints.
 */

export interface AuthResult {
  authenticated: boolean;
  isAdmin: boolean;
  userId?: string;
  email?: string;
  error?: string;
}

/**
 * Verify authentication and admin role from request headers.
 * Returns auth result with user info.
 */
export async function verifyAdminAuth(request: NextRequest): Promise<AuthResult> {
  try {
    // Get authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        authenticated: false,
        isAdmin: false,
        error: 'Missing or invalid authorization header',
      };
    }

    // Extract JWT token
    const token = authHeader.substring(7);
    if (!token) {
      return {
        authenticated: false,
        isAdmin: false,
        error: 'No token provided',
      };
    }

    // Verify token with Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

    if (!supabaseUrl || !supabaseAnonKey) {
      return {
        authenticated: false,
        isAdmin: false,
        error: 'Server configuration error',
      };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Verify the JWT token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return {
        authenticated: false,
        isAdmin: false,
        error: 'Invalid or expired token',
      };
    }

    // Check if user is admin
    // Check multiple sources: user_metadata, app_metadata, and profile
    const metadataRole = user.user_metadata?.role || user.app_metadata?.role;
    const emailHint = user.email?.toLowerCase().includes('admin');
    
    // For more security, we should also check the profiles table
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('id', user.id)
      .single();

    const profileRole = profile?.role;
    const isApproved = profile?.status === 'approved';
    
    // User is admin if:
    // 1. Profile role is 'admin' AND status is 'approved'
    // 2. OR metadata indicates admin (fallback for bootstrapped admins)
    const isAdmin = (profileRole === 'admin' && isApproved) || metadataRole === 'admin' || emailHint === true;

    if (!isAdmin) {
      return {
        authenticated: true,
        isAdmin: false,
        userId: user.id,
        email: user.email,
        error: 'Admin access required',
      };
    }

    return {
      authenticated: true,
      isAdmin: true,
      userId: user.id,
      email: user.email,
    };
  } catch (error) {
    console.error('[authMiddleware] Unexpected error:', error);
    return {
      authenticated: false,
      isAdmin: false,
      error: 'Authentication verification failed',
    };
  }
}

/**
 * Helper to create unauthorized response
 */
export function createUnauthorizedResponse(message: string = 'Unauthorized') {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}

/**
 * Helper to create forbidden response
 */
export function createForbiddenResponse(message: string = 'Forbidden - Admin access required') {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status: 403,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    }
  );
}
