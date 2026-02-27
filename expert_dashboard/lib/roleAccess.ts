import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Role Access Configuration
 * Centralized role-based access control for the BitterScan dashboard
 */

export type UserRole = 'admin' | 'expert' | 'farmer';
export type UserStatus = 'pending' | 'approved' | 'rejected' | null;

export interface UserAccessProfile {
  role: UserRole;
  status: UserStatus;
  canAccessDashboard: boolean;
  dashboardRoute: string | null;
  errorMessage: string | null;
}

/**
 * Dashboard routes by role
 */
export const DASHBOARD_ROUTES: Record<UserRole, string | null> = {
  admin: '/admin-dashboard',
  expert: '/expert-dashboard',
  farmer: null, // Farmers cannot access any dashboard
};

/**
 * Error messages for access denial
 */
export const ACCESS_ERRORS = {
  FARMER_DENIED: 'Access denied: Farmers cannot access the dashboard. Please use the mobile app.',
  EXPERT_NOT_APPROVED: 'Your account is pending admin approval. Please wait for confirmation.',
  EXPERT_REJECTED: 'Your account has been rejected. Please contact an administrator.',
  NO_PROFILE: 'Unable to verify account. Please try again or contact support.',
  INVALID_CREDENTIALS: 'Invalid email or password.',
  ROLE_MISMATCH: 'You do not have permission to access this page.',
} as const;

/**
 * Fetches the user's role and status from Supabase
 * Uses profiles table as primary source, falls back to user_roles if needed
 * 
 * @param supabase - Supabase client instance
 * @param userId - The authenticated user's ID
 * @returns UserAccessProfile with role, status, and access information
 */
export async function getUserAccessProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<UserAccessProfile> {
  try {
    // Primary: Try to fetch from profiles table (has both role and status)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, status')
      .eq('id', userId)
      .single();

    if (profile && !profileError) {
      return buildAccessProfile(profile.role, profile.status);
    }

    // Fallback: Try user_roles table if profiles doesn't have the data
    const { data: userRole, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (userRole && !roleError) {
      // user_roles doesn't have status, default to 'approved' for admin, 'pending' for others
      const status = userRole.role === 'admin' ? 'approved' : 'pending';
      return buildAccessProfile(userRole.role, status);
    }

    // Ultimate fallback: Default to farmer (deny access)
    return buildAccessProfile('farmer', null);
  } catch (error) {
    console.error('[roleAccess] Error fetching user access profile:', error);
    return buildAccessProfile('farmer', null);
  }
}

/**
 * Builds the UserAccessProfile based on role and status
 */
function buildAccessProfile(
  role: string | null,
  status: string | null
): UserAccessProfile {
  // Normalize role - default to 'farmer' if unknown
  const normalizedRole: UserRole = 
    role === 'admin' || role === 'expert' 
      ? role 
      : 'farmer';
  
  const normalizedStatus: UserStatus = 
    status === 'approved' || status === 'pending' || status === 'rejected'
      ? status
      : null;

  // Check access rules
  const accessResult = checkDashboardAccess(normalizedRole, normalizedStatus);

  return {
    role: normalizedRole,
    status: normalizedStatus,
    canAccessDashboard: accessResult.allowed,
    dashboardRoute: accessResult.allowed ? DASHBOARD_ROUTES[normalizedRole] : null,
    errorMessage: accessResult.errorMessage,
  };
}

/**
 * Checks if a user can access the dashboard based on role and status
 */
function checkDashboardAccess(
  role: UserRole,
  status: UserStatus
): { allowed: boolean; errorMessage: string | null } {
  // Rule 1: Farmers can NEVER access the dashboard
  if (role === 'farmer') {
    return { allowed: false, errorMessage: ACCESS_ERRORS.FARMER_DENIED };
  }

  // Rule 2: Admins always have access (regardless of status)
  if (role === 'admin') {
    return { allowed: true, errorMessage: null };
  }

  // Rule 3: Experts must be approved
  if (role === 'expert') {
    if (status === 'approved') {
      return { allowed: true, errorMessage: null };
    }
    if (status === 'rejected') {
      return { allowed: false, errorMessage: ACCESS_ERRORS.EXPERT_REJECTED };
    }
    // pending or null status
    return { allowed: false, errorMessage: ACCESS_ERRORS.EXPERT_NOT_APPROVED };
  }

  // Fallback - deny access
  return { allowed: false, errorMessage: ACCESS_ERRORS.NO_PROFILE };
}

/**
 * Checks if a user with a given role can access a specific route
 */
export function canAccessRoute(role: UserRole, pathname: string): boolean {
  // Define allowed routes per role
  const ROLE_ROUTE_MAP: Record<UserRole, string[]> = {
    admin: [
      '/admin-dashboard',
      '/reports',
      '/data-visualization',
      '/history',
      '/profile',
      '/manage-disease-info',
    ],
    expert: [
      '/expert-dashboard',
      '/dashboard',
      '/validate',
      '/history',
      '/profile',
      '/manage-disease-info',
      '/register', // Experts can create new accounts
    ],
    farmer: [], // No dashboard routes for farmers
  };

  const allowedRoutes = ROLE_ROUTE_MAP[role] || [];
  
  // Check if pathname matches any allowed route (including sub-routes)
  return allowedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}

/**
 * Gets the correct dashboard route for a role
 */
export function getDashboardRouteForRole(role: UserRole): string {
  return DASHBOARD_ROUTES[role] || '/login';
}

/**
 * Checks if the current route requires a specific role
 * Returns the required role or null if public/any role allowed
 */
export function getRequiredRoleForRoute(pathname: string): UserRole | null {
  if (pathname.startsWith('/admin-dashboard')) {
    return 'admin';
  }
  if (pathname.startsWith('/expert-dashboard') || pathname.startsWith('/validate')) {
    return 'expert';
  }
  // For shared routes like /history, /profile - any authenticated user
  return null;
}
