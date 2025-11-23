/**
 * Shared type definitions for the BitterScan Expert Dashboard
 */

export interface Scan {
  id: number;
  farmer_id: string;
  scan_type: 'leaf_disease' | 'fruit_maturity';
  ai_prediction: string;
  image_url: string;
  status: 'Pending Validation' | 'Validated' | 'Corrected';
  created_at: string;
  updated_at: string;
  scan_uuid: string;
  expert_comment?: string;
  expert_validation?: string | null;
  // Optional scan result details
  confidence?: number | string;
  solution?: string;
  recommended_products?: string;
  // Joined profile data
  farmer_profile?: {
    id: string;
    username: string;
    full_name: string;
    email: string;
    profile_picture: string;
  };
}

export interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  email: string;
  profile_picture?: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email?: string;
  user_metadata?: {
    full_name?: string;
    username?: string;
    role?: string;
  };
}

export interface UserContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
}

export type ScanType = 'leaf_disease' | 'fruit_maturity';
export type ScanStatus = 'Pending Validation' | 'Validated' | 'Corrected';

export interface ValidationHistory {
  id: number;
  scan_id: number;
  expert_id: string;
  ai_prediction: string;
  expert_validation?: string;
  status: 'Validated' | 'Corrected';
  validated_at: string;
  // Joined profile data
  expert_profile?: {
    id: string;
    username: string;
    full_name: string;
    email: string;
  };
  // Joined scan data
  scan?: Scan;
}

export interface Notification {
  id: number;
  expert_id: string;
  scan_id: number;
  message: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
  // Joined scan data
  scan?: Scan;
}

/**
 * Type for Supabase API errors (AuthApiError, PostgrestError, etc.)
 */
export interface SupabaseApiError {
  message?: string;
  status?: number;
  code?: string;
  details?: string;
  hint?: string;
}

/**
 * Type guard to check if an error is a Supabase API error
 */
export function isSupabaseApiError(error: unknown): error is SupabaseApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    ('message' in error || 'status' in error || 'code' in error)
  );
}