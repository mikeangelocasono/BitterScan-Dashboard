/**
 * Shared type definitions for the BitterScan Expert Dashboard
 */

// Base scan interface with common fields
interface BaseScan {
  id: number;
  farmer_id: string;
  scan_type: 'leaf_disease' | 'fruit_maturity';
  image_url: string;
  status: 'Pending Validation' | 'Validated' | 'Corrected';
  created_at: string;
  updated_at: string;
  scan_uuid: string;
  expert_comment?: string;
  expert_validation?: string | null;
  confidence?: number | string;
  // Joined profile data
  farmer_profile?: {
    id: string;
    username: string;
    full_name: string;
    email: string;
    profile_picture: string;
  };
}

// Leaf disease scan interface
export interface LeafDiseaseScan extends BaseScan {
  scan_type: 'leaf_disease';
  disease_detected: string; // Maps to ai_prediction in old schema
  solution?: string;
  recommendation?: string; // Maps to recommended_products in old schema
}

// Fruit ripeness scan interface
export interface FruitRipenessScan extends BaseScan {
  scan_type: 'fruit_maturity';
  ripeness_stage: string; // Maps to ai_prediction in old schema
  harvest_recommendation?: string; // Maps to solution in old schema
}

// Unified Scan type for backward compatibility
export type Scan = LeafDiseaseScan | FruitRipenessScan;

// Helper type guards
export function isLeafDiseaseScan(scan: Scan): scan is LeafDiseaseScan {
  return scan.scan_type === 'leaf_disease';
}

export function isFruitRipenessScan(scan: Scan): scan is FruitRipenessScan {
  return scan.scan_type === 'fruit_maturity';
}

// Helper to get ai_prediction from either scan type (for backward compatibility)
export function getAiPrediction(scan: Scan): string {
  if (isLeafDiseaseScan(scan)) {
    return scan.disease_detected;
  }
  return scan.ripeness_stage;
}

// Helper to get solution/recommendation from either scan type
export function getSolution(scan: Scan): string | undefined {
  if (isLeafDiseaseScan(scan)) {
    return scan.solution;
  }
  return scan.harvest_recommendation;
}

// Helper to get recommended products from either scan type
export function getRecommendedProducts(scan: Scan): string | undefined {
  if (isLeafDiseaseScan(scan)) {
    return scan.recommendation;
  }
  return undefined;
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
  scan_id: string | number; // Can be UUID (string) or numeric ID depending on schema
  expert_id: string;
  expert_name?: string; // Expert's full name stored directly in validation_history
  ai_prediction: string; // Disease detected or ripeness stage
  expert_validation?: string;
  expert_comment?: string | null;
  status: 'Validated' | 'Corrected';
  validated_at: string;
  // Joined profile data
  expert_profile?: {
    id: string;
    username: string;
    full_name: string;
    email: string;
  };
  // Joined scan data - can be from either table
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