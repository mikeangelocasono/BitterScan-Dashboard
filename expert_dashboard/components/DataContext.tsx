"use client";

import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase, validateSupabaseClient } from "./supabase";
import { Scan, ValidationHistory, isSupabaseApiError, UserProfile, isNonAmpalayaScan } from "../types";
import { useUser } from "./UserContext";

// Type definitions for Supabase Realtime payloads
type RealtimePayload<T = Record<string, unknown>> = {
	new: T | null;
	old: T | null;
	eventType: 'INSERT' | 'UPDATE' | 'DELETE';
	schema: string;
	table: string;
};

// Type for scans table Realtime payload
type ScanRealtimePayload = RealtimePayload<Partial<Scan>>;

// Type for validation_history table Realtime payload
type ValidationHistoryRealtimePayload = RealtimePayload<Partial<ValidationHistory>>;

// Type for profiles table Realtime payload
type ProfileRealtimePayload = RealtimePayload<{ id?: string }>;

// Database row types (raw Supabase responses)
type DatabaseProfile = {
	id: string;
	username: string;
	full_name: string;
	email: string;
	profile_picture?: string | null;
	role: string;
	created_at: string;
	updated_at: string;
};

type DatabaseLeafDiseaseScan = {
	id: number;
	farmer_id: string;
	scan_uuid: string;
	image_url: string;
	disease_detected: string;
	solution?: string | null;
	recommendation?: string | null;
	confidence?: number | string | null;
	status: 'Pending' | 'Pending Validation' | 'Validated' | 'Corrected';
	created_at: string;
	updated_at: string;
};

type DatabaseFruitRipenessScan = {
	id: number;
	farmer_id: string;
	scan_uuid: string;
	image_url: string;
	ripeness_stage: string;
	harvest_recommendation?: string | null;
	confidence?: number | string | null;
	status: 'Pending' | 'Pending Validation' | 'Validated' | 'Corrected';
	created_at: string;
	updated_at: string;
};

type DatabaseValidationHistory = {
	id: number;
	scan_id: string;
	scan_type: 'leaf_disease' | 'fruit_maturity';
	expert_id: string;
	expert_name?: string | null;
	ai_prediction: string;
	expert_validation?: string | null;
	expert_comment?: string | null;
	status: 'Validated' | 'Corrected';
	validated_at: string;
};

// Error object type for logging
type ErrorLogObject = {
	message?: string;
	details?: string;
	hint?: string;
	code?: string | number;
};

type DataContextValue = {
	scans: Scan[];
	validationHistory: ValidationHistory[];
	totalUsers: number;
	loading: boolean;
	error: string | null;
	refreshData: (showSpinner?: boolean) => Promise<void>;
	removeScanFromState: (scanId: number) => void;
	updateScanStatusInState: (scanId: number, status: Scan['status']) => void;
};

const DataContext = createContext<DataContextValue | undefined>(undefined);

// Cache keys for localStorage
const CACHE_KEY_SCANS = 'bs:cache:scans';
const CACHE_KEY_VALIDATIONS = 'bs:cache:validations';
const CACHE_KEY_USERS = 'bs:cache:users';
const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes cache expiry

/**
 * Load cached data from localStorage
 * Returns null if cache is expired or doesn't exist
 */
function loadFromCache<T>(key: string): T | null {
	if (typeof window === 'undefined') return null;
	try {
		const cached = localStorage.getItem(key);
		if (!cached) return null;
		const { data, timestamp } = JSON.parse(cached);
		// Check if cache is still valid (within expiry time)
		if (Date.now() - timestamp < CACHE_EXPIRY_MS) {
			return data as T;
		}
		// Cache expired, but still return it for stale-while-revalidate
		return data as T;
	} catch {
		return null;
	}
}

/**
 * Save data to localStorage cache with timestamp
 */
function saveToCache<T>(key: string, data: T): void {
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(key, JSON.stringify({
			data,
			timestamp: Date.now()
		}));
	} catch (err) {
		// localStorage might be full or disabled
		console.warn('[DataContext] Failed to save to cache:', err);
	}
}

/**
 * Helper to wrap a promise with a timeout.
 * Returns the promise result or default value if timeout is exceeded.
 * This prevents infinite loading when browser throttles/freezes requests.
 */
async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	defaultValue: T,
	label?: string
): Promise<T> {
	let timeoutId: NodeJS.Timeout;
	const timeoutPromise = new Promise<T>((resolve) => {
		timeoutId = setTimeout(() => {
			if (label) console.warn(`[DataContext] ${label} timeout after ${timeoutMs}ms - using default value`);
			resolve(defaultValue);
		}, timeoutMs);
	});
	
	try {
		const result = await Promise.race([promise, timeoutPromise]);
		clearTimeout(timeoutId!);
		return result;
	} catch (err) {
		clearTimeout(timeoutId!);
		throw err;
	}
}

export function DataProvider({ children }: { children: ReactNode }) {
	const { user, profile, loading: userLoading, sessionReady } = useUser();
	
	// Initialize state from cache for instant display (stale-while-revalidate)
	const [scans, setScans] = useState<Scan[]>(() => {
		const cached = loadFromCache<Scan[]>(CACHE_KEY_SCANS);
		if (cached && cached.length > 0) {
			console.log('[DataContext] Loaded', cached.length, 'scans from cache');
		}
		return cached || [];
	});
	const [validationHistory, setValidationHistory] = useState<ValidationHistory[]>(() => {
		const cached = loadFromCache<ValidationHistory[]>(CACHE_KEY_VALIDATIONS);
		if (cached && cached.length > 0) {
			console.log('[DataContext] Loaded', cached.length, 'validations from cache');
		}
		return cached || [];
	});
	const [totalUsers, setTotalUsers] = useState(() => {
		return loadFromCache<number>(CACHE_KEY_USERS) || 0;
	});
	// Start with loading=false since we show cached data immediately
	// This prevents loading spinner when we have cached data
	const [loading, setLoading] = useState(false);
	// Track if we have any cached data to avoid showing spinner
	const hasCachedData = useRef(false);
	// Ref to track loading state for visibility handler (avoids stale closure issues)
	const loadingRef = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const initialFetched = useRef(false);
	const isFetchingRef = useRef(false);
	const fetchDataRef = useRef<typeof fetchData | null>(null);
	const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
	const subscriptionActiveRef = useRef(false);
	const subscriptionStatusRef = useRef<'SUBSCRIBED' | 'SUBSCRIBING' | 'CLOSED' | 'TIMED_OUT' | 'CHANNEL_ERROR' | null>(null);
	const userRef = useRef(user);
	const userLoadingRef = useRef(userLoading);
	const healthCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
	const subscriptionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const reconnectAttemptsRef = useRef(0);
	const maxReconnectAttempts = 5;
	const isSubscribingRef = useRef(false); // Track if we're currently in the process of subscribing
	// Track previous user ID to detect actual logout vs transient state changes
	const previousUserIdRef = useRef<string | null>(null);
	// Master loading timeout to prevent infinite loading - cleared when loading completes
	const masterLoadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	const isReady = useMemo(() => Boolean(user?.id), [user?.id]);
	
	// Keep user ref updated for timeout checks and track previous user for logout detection
	useEffect(() => {
		// Only update previousUserIdRef when user actually changes (not on every render)
		// This helps detect actual logout vs transient state changes
		if (user?.id !== previousUserIdRef.current) {
			previousUserIdRef.current = user?.id ?? null;
		}
		userRef.current = user;
		userLoadingRef.current = userLoading;
	}, [user, userLoading]);

	const seenRecursionErrors = useRef<{ [key: string]: boolean }>({});

	// Keep loadingRef in sync with loading state
	useEffect(() => {
		loadingRef.current = loading;
	}, [loading]);

	/**
	 * Helper function to fetch leaf disease scans from Supabase.
	 * Returns empty array [] if fetch fails or no data is available.
	 * Includes 10s timeout to prevent hanging after tab switch.
	 */
	const fetchLeafScans = useCallback(async (): Promise<DatabaseLeafDiseaseScan[]> => {
		try {
			const fetchPromise = supabase
				.from("leaf_disease_scans")
				.select("*")
				.order("created_at", { ascending: false });

			// Add 10s timeout to prevent hanging
			const { data, error } = await withTimeout(fetchPromise, 10000, { data: [], error: null }, 'fetchLeafScans');

			if (error && Object.keys(error).length > 0) {
				const errorMsg = (error as ErrorLogObject).message || (error as ErrorLogObject).details || "Unknown error";
				const isRecursion = typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('infinite recursion');
				if (!isRecursion || !seenRecursionErrors.current['leaf']) {
					(isRecursion ? console.warn : console.error)("Error fetching leaf_disease_scans:", errorMsg);
					if (isRecursion) seenRecursionErrors.current['leaf'] = true;
				}
			}

			return data || [];
		} catch (err: unknown) {
			const errorMsg = err instanceof Error ? err.message : "Unknown error";
			console.error("Error fetching leaf_disease_scans:", errorMsg, { error: err });
			return [];
		}
	}, []);

	/**
	 * Helper function to fetch fruit ripeness scans from Supabase.
	 * Returns empty array [] if fetch fails or no data is available.
	 * Includes 10s timeout to prevent hanging after tab switch.
	 */
	const fetchFruitScans = useCallback(async (): Promise<DatabaseFruitRipenessScan[]> => {
		try {
			const fetchPromise = supabase
				.from("fruit_ripeness_scans")
				.select("*")
				.order("created_at", { ascending: false });

			// Add 10s timeout to prevent hanging
			const { data, error } = await withTimeout(fetchPromise, 10000, { data: [], error: null }, 'fetchFruitScans');

			if (error && Object.keys(error).length > 0) {
				const errorMsg = (error as ErrorLogObject).message || (error as ErrorLogObject).details || "Unknown error";
				const isRecursion = typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('infinite recursion');
				if (!isRecursion || !seenRecursionErrors.current['fruit']) {
					(isRecursion ? console.warn : console.error)("Error fetching fruit_ripeness_scans:", errorMsg);
					if (isRecursion) seenRecursionErrors.current['fruit'] = true;
				}
			}

			return data || [];
		} catch (err: unknown) {
			const errorMsg = err instanceof Error ? err.message : "Unknown error";
			console.error("Error fetching fruit_ripeness_scans:", errorMsg, { error: err });
			return [];
		}
	}, []);

	/**
	 * Helper function to fetch validation history from Supabase.
	 * Returns empty array [] if fetch fails or no data is available.
	 * Includes 10s timeout to prevent hanging after tab switch.
	 */
	const fetchValidationHistory = useCallback(async (): Promise<DatabaseValidationHistory[]> => {
		try {
			const fetchPromise = supabase
				.from("validation_history")
				.select("*")
				.order("validated_at", { ascending: false });

			// Add 10s timeout to prevent hanging
			const { data, error } = await withTimeout(fetchPromise, 10000, { data: [], error: null }, 'fetchValidationHistory');

			if (error && Object.keys(error).length > 0) {
				const errorMsg = (error as ErrorLogObject).message || (error as ErrorLogObject).details || "Unknown error";
				const isRecursion = typeof errorMsg === 'string' && errorMsg.toLowerCase().includes('infinite recursion');
				if (!isRecursion || !seenRecursionErrors.current['validation']) {
					(isRecursion ? console.warn : console.error)("Error fetching validation_history:", errorMsg);
					if (isRecursion) seenRecursionErrors.current['validation'] = true;
				}
			}

			return data || [];
		} catch (err: unknown) {
			const errorMsg = err instanceof Error ? err.message : "Unknown error";
			console.error("Error fetching validation_history:", errorMsg, { error: err });
			return [];
		}
	}, []);

	/**
	 * Helper function to fetch all profiles from Supabase.
	 * Returns empty array [] if fetch fails or no data is available.
	 * Also fetches user count (for dashboard analytics).
	 * Logs meaningful error messages only for actual errors.
	 */
	// Profiles fetch removed to avoid recursive RLS policy issues; we keep count at 0 and attach profiles only when provided by backend.

	const fetchData = useCallback(
		async (showSpinner = false) => {
			const effectiveRole = profile?.role || user?.user_metadata?.role || null;
			// Better admin detection: check profile, user_metadata, or email hint
			// This ensures admin can proceed even before updateUser metadata propagates
			const adminEmailHint = (user?.email || '').toLowerCase().includes('admin');
			const isAdmin = effectiveRole === 'admin' || adminEmailHint;

			// Don't fetch if user is not ready or already fetching
			if (!isReady || isFetchingRef.current) {
				// If not ready and loading, clear loading state to prevent infinite spinner
				if (!isReady && !initialFetched.current && loading) {
					setLoading(false);
				}
				return;
			}

			// For non-approved, non-admin users with profile loaded, short-circuit to avoid unnecessary API calls
			// The API will also reject them, but this saves a network request
			if (user && !isAdmin && profile && profile.status !== 'approved') {
				setScans([]);
				setValidationHistory([]);
				setTotalUsers(0);
				setLoading(false);
				console.log('[DataContext] User not approved, skipping data fetch');
				return;
			}

			// Validate Supabase client is properly initialized before making API calls
			try {
				validateSupabaseClient();
			} catch (err) {
				const errorMsg = err instanceof Error ? err.message : 'Supabase client is not properly configured. Please check your Vercel environment variables.';
				setError(errorMsg);
				setLoading(false);
				isFetchingRef.current = false;
				console.error('[DataContext] Supabase validation failed:', errorMsg);
				return;
			}

			isFetchingRef.current = true;

			// Only show spinner if we explicitly requested AND we have no cached data
			// With stale-while-revalidate, we show cached data immediately and update silently
			const hasData = scans.length > 0 || validationHistory.length > 0;
			const shouldShowSpinner = (showSpinner || !initialFetched.current) && !hasData;
			if (shouldShowSpinner) setLoading(true);

			try {
				setError(null);

				// Get current session token for authentication
				const { data: { session } } = await supabase.auth.getSession();
				const token = session?.access_token;
				
				if (!token) {
					console.warn('[DataContext] No auth token available for API call');
					setScans([]);
					setValidationHistory([]);
					setTotalUsers(0);
					setLoading(false);
					isFetchingRef.current = false;
					return;
				}

				// Fetch scans and validation history from API (bypasses RLS, works for experts and admins)
				const scansRes = await fetch('/api/scans', {
					cache: 'no-store',
					headers: {
						'Authorization': `Bearer ${token}`,
					}
				});

				if (!scansRes.ok) {
					const errorBody = await scansRes.json().catch(() => ({}));
					const errorMsg = errorBody.error || `Failed to fetch scans (${scansRes.status})`;
					console.error('[DataContext] Scans API error:', errorMsg);
					
					// If authentication error, clear state
					if (scansRes.status === 401 || scansRes.status === 403) {
						setError('Session expired. Please log in again.');
						setScans([]);
						setValidationHistory([]);
					} else {
						setError(errorMsg);
					}
					setLoading(false);
					isFetchingRef.current = false;
					return;
				}

				const scansData = await scansRes.json();
				const allScans = (scansData.scans || []).filter((s: Scan) => !isNonAmpalayaScan(s));
				const validations = scansData.validationHistory || [];

				// Update state with fetched data
				setScans(allScans);
				setValidationHistory(validations);
				
				// Save to cache for instant display on next load
				saveToCache(CACHE_KEY_SCANS, allScans);
				saveToCache(CACHE_KEY_VALIDATIONS, validations);

				// For admin users, also fetch totalUsers from API
				if (isAdmin) {
					try {
						const usersRes = await fetch('/api/users', { 
							cache: 'no-store',
							headers: {
								'Authorization': `Bearer ${token}`,
							}
						});
						if (usersRes.ok) {
							const body = await usersRes.json();
							const userCount = body.count || body.profiles?.length || 0;
							setTotalUsers(userCount);
							saveToCache(CACHE_KEY_USERS, userCount);
						} else {
							console.warn('[DataContext] Failed to fetch totalUsers from API:', usersRes.status);
							setTotalUsers(0);
						}
					} catch (apiErr) {
						console.warn('[DataContext] Error fetching totalUsers:', apiErr);
						setTotalUsers(0);
					}
				} else {
					setTotalUsers(0);
				}

				initialFetched.current = true;
				console.log('[DataContext] Initial data fetch complete. Scans:', allScans.length, 'Validations:', validations.length);
		} catch (err: unknown) {
			// Handle refresh token errors
			if (isSupabaseApiError(err)) {
				const errorMessage = err.message || "";
				if (errorMessage.includes('Refresh Token') || errorMessage.includes('refresh_token_not_found') || err.status === 401) {
					console.warn('Invalid refresh token detected in data fetch, user will be signed out...');
					// The UserContext will handle the sign-out via auth state change
					setError("Session expired. Please log in again.");
					isFetchingRef.current = false;
					setLoading(false);
					return;
				}
			}
			
			// Check for Supabase client initialization errors
			const errorMessage = err instanceof Error ? err.message : String(err);
			if (errorMessage.includes('Missing Supabase') || errorMessage.includes('environment variables')) {
				setError("Supabase configuration error. Please check environment variables.");
			} else if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
				setError("Network error. Please check your connection and try again.");
			} else {
				setError(`Failed to load data: ${errorMessage}`);
			}
			
			// Log meaningful errors only (avoid logging empty {} errors)
			if (err && typeof err === 'object' && Object.keys(err as object).length > 0) {
				const errorObj = err as ErrorLogObject;
				console.error("Error in fetchData:", {
					message: errorObj.message || errorMessage || 'Unknown error',
					details: errorObj.details,
					code: errorObj.code,
					hint: errorObj.hint,
				});
			} else if (err) {
				console.error("Error in fetchData:", err);
			}
		} finally {
			isFetchingRef.current = false;
			setLoading(false);
			// Clear master loading timeout when fetch completes
			if (masterLoadingTimeoutRef.current) {
				clearTimeout(masterLoadingTimeoutRef.current);
				masterLoadingTimeoutRef.current = null;
			}
		}
	},
	[isReady, user, profile, loading]
);

	// Keep ref updated with latest fetchData function
	useEffect(() => {
		fetchDataRef.current = fetchData;
	}, [fetchData]);

	// IMMEDIATE DATA FETCH: Trigger as soon as user is authenticated (isReady)
	// Don't wait for sessionReady or profile - the API uses Bearer token from session
	// This eliminates the delay caused by waiting for profile to load
	useEffect(() => {
		if (isReady && !initialFetched.current && !isFetchingRef.current) {
			console.log('[DataContext] User authenticated, fetching data immediately...');
			fetchData(true);
		}
	}, [isReady, fetchData]);

	// Re-fetch when profile loads (in case we need to update based on role)
	// This runs in parallel with the initial fetch above
	useEffect(() => {
		// Only re-fetch if profile just loaded and initial fetch is complete
		// This prevents double-fetching on initial load
		if (profile && isReady && initialFetched.current && !isFetchingRef.current) {
			// Skip re-fetch if we just loaded - profile came with initial data
			return;
		}
	}, [profile, isReady]);

	// MASTER LOADING TIMEOUT: Ultimate safety net to prevent infinite loading states
	// This catches any edge case where loading gets stuck (tab throttling, network issues, etc.)
	useEffect(() => {
		// Only start timeout when loading is true
		if (!loading) {
			if (masterLoadingTimeoutRef.current) {
				clearTimeout(masterLoadingTimeoutRef.current);
				masterLoadingTimeoutRef.current = null;
			}
			return;
		}

		// Set a 1.5-second master timeout - if loading is still true after this, force clear it
		masterLoadingTimeoutRef.current = setTimeout(() => {
			if (loading) {
				console.warn('[DataContext] Master loading timeout (1.5s) - forcing loading state to clear');
				setLoading(false);
				isFetchingRef.current = false; // Also reset fetching flag
				// Don't set error - just allow UI to render with empty data if needed
			}
			masterLoadingTimeoutRef.current = null;
		}, 1500);

		return () => {
			if (masterLoadingTimeoutRef.current) {
				clearTimeout(masterLoadingTimeoutRef.current);
				masterLoadingTimeoutRef.current = null;
			}
		};
	}, [loading]);

	// Helper function to fetch a single scan with its profile
	// Tries both tables based on scan_type or scan_uuid
	const fetchScanWithProfile = useCallback(async (scanId: number, scanType?: 'leaf_disease' | 'fruit_maturity', scanUuid?: string): Promise<Scan | null> => {
		try {
			let scanData: DatabaseLeafDiseaseScan | DatabaseFruitRipenessScan | null = null;
			let scanError: unknown = null;

			// If we have scan_type, fetch from the specific table
			if (scanType === 'leaf_disease') {
				const response = await supabase
					.from("leaf_disease_scans")
					.select("*")
					.eq("id", scanId)
					.single();
				scanData = response.data;
				scanError = response.error;
			} else if (scanType === 'fruit_maturity') {
				const response = await supabase
					.from("fruit_ripeness_scans")
					.select("*")
					.eq("id", scanId)
					.single();
				scanData = response.data;
				scanError = response.error;
			} else {
				// If no scan_type, try both tables (fallback)
				// Try leaf_disease_scans first
				const leafResponse = await supabase
					.from("leaf_disease_scans")
					.select("*")
					.eq("id", scanId)
					.single();

				if (!leafResponse.error && leafResponse.data) {
					scanData = leafResponse.data;
					scanType = 'leaf_disease';
				} else {
					// Try fruit_ripeness_scans
					const fruitResponse = await supabase
						.from("fruit_ripeness_scans")
						.select("*")
						.eq("id", scanId)
						.single();
					
					if (!fruitResponse.error && fruitResponse.data) {
						scanData = fruitResponse.data;
						scanType = 'fruit_maturity';
					} else {
						scanError = fruitResponse.error;
					}
				}
			}

			if (scanError || !scanData) {
				console.error("Error fetching scan:", scanError);
				return null;
			}

			// Fetch farmer profile separately
			let farmerProfile = undefined;
			if (scanData.farmer_id) {
				const { data: profile } = await supabase
					.from("profiles")
					.select("id, username, full_name, email, profile_picture")
					.eq("id", scanData.farmer_id)
					.single();
				farmerProfile = profile || undefined;
			}

			// Transform based on scan type
			if (scanType === 'leaf_disease') {
				return {
					...scanData,
					scan_type: 'leaf_disease' as const,
					ai_prediction: scanData.disease_detected,
					solution: scanData.solution,
					recommended_products: scanData.recommendation,
					farmer_profile: farmerProfile,
				};
			} else {
				return {
					...scanData,
					scan_type: 'fruit_maturity' as const,
					ai_prediction: scanData.ripeness_stage,
					solution: scanData.harvest_recommendation,
					recommended_products: undefined,
					farmer_profile: farmerProfile,
				};
			}
		} catch (err: unknown) {
			console.error("Error fetching scan:", err);
			return null;
		}
	}, []);

	// Helper function to fetch a single validation with its relations
	// Note: validation_history.scan_id is a UUID, so we need to find the scan by scan_uuid
	const fetchValidationWithRelations = useCallback(async (validationId: number): Promise<ValidationHistory | null> => {
		try {
			const { data, error } = await supabase
				.from("validation_history")
				.select("*")
				.eq("id", validationId)
				.single();

			if (error) {
				console.error("Error fetching validation:", error);
				return null;
			}

			// Fetch expert profile separately
			let expertProfile = undefined;
			if (data.expert_id) {
				const { data: profile } = await supabase
					.from("profiles")
					.select("id, username, full_name, email")
					.eq("id", data.expert_id)
					.single();
				expertProfile = profile || undefined;
			}

			// Find the related scan by scan_uuid from either table
			let relatedScan = undefined;
			if (data && data.scan_id) {
				const scanUuid = String(data.scan_id).trim();
				
				// Try leaf_disease_scans first
				const { data: leafScan } = await supabase
					.from("leaf_disease_scans")
					.select("*")
					.eq("scan_uuid", scanUuid)
					.single();

				if (leafScan) {
					// Fetch farmer profile for the scan
					let farmerProfile = undefined;
					if (leafScan.farmer_id) {
						const { data: profile } = await supabase
							.from("profiles")
							.select("id, username, full_name, email, profile_picture")
							.eq("id", leafScan.farmer_id)
							.single();
						farmerProfile = profile || undefined;
					}

					relatedScan = {
						...leafScan,
						scan_type: 'leaf_disease' as const,
						ai_prediction: leafScan.disease_detected,
						solution: leafScan.solution,
						recommended_products: leafScan.recommendation,
						farmer_profile: farmerProfile,
					};
				} else {
					// Try fruit_ripeness_scans
					const { data: fruitScan } = await supabase
						.from("fruit_ripeness_scans")
						.select("*")
						.eq("scan_uuid", scanUuid)
						.single();

					if (fruitScan) {
						// Fetch farmer profile for the scan
						let farmerProfile = undefined;
						if (fruitScan.farmer_id) {
							const { data: profile } = await supabase
								.from("profiles")
								.select("id, username, full_name, email, profile_picture")
								.eq("id", fruitScan.farmer_id)
								.single();
							farmerProfile = profile || undefined;
						}

						relatedScan = {
							...fruitScan,
							scan_type: 'fruit_maturity' as const,
							ai_prediction: fruitScan.ripeness_stage,
							solution: fruitScan.harvest_recommendation,
							recommended_products: undefined,
							farmer_profile: farmerProfile,
						};
					}
				}
			}

			return {
				...data,
				expert_profile: expertProfile,
				scan: relatedScan,
			};
		} catch (err: unknown) {
			console.error("Error fetching validation:", err);
			return null;
		}
	}, []);

	useEffect(() => {
		if (!isReady) {
			// Clean up subscription when user becomes unavailable
			if (process.env.NODE_ENV === 'development') {
				console.log('[Realtime] 🧹 User not ready, cleaning up subscription', {
					userId: user?.id || 'none',
					hasChannel: !!channelRef.current,
					subscriptionActive: subscriptionActiveRef.current,
					userLoading: userLoading
				});
			}
			
			// Clear health check interval
			if (healthCheckIntervalRef.current) {
				clearInterval(healthCheckIntervalRef.current);
				healthCheckIntervalRef.current = null;
			}
			
			// Clear subscription timeout
			if (subscriptionTimeoutRef.current) {
				clearTimeout(subscriptionTimeoutRef.current);
				subscriptionTimeoutRef.current = null;
			}
			
			// Clear reconnect timeout
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
			
			// Reset reconnect attempts
			reconnectAttemptsRef.current = 0;
			
			if (channelRef.current) {
				supabase.removeChannel(channelRef.current);
				channelRef.current = null;
				subscriptionActiveRef.current = false;
				subscriptionStatusRef.current = null;
			}
			// CRITICAL FIX: Only reset initialFetched on ACTUAL logout (user was logged in before, now logged out)
			// Do NOT reset on transient state changes (e.g., tab visibility triggering state updates)
			// This prevents infinite loading loops when switching tabs
			// The user logout effect at the bottom handles the actual cleanup on logout
			// Here we only clean up subscriptions, not the fetched data flag
			
			// Only show error if UserContext is still loading after timeout
			// If UserContext has resolved with no user, that's fine - user just needs to log in
			// Only show error if UserContext is stuck in loading state
			if (userLoading) {
				// Set loading to false if user context is still loading after a timeout
				// This prevents infinite loading if user context never resolves
				// Match UserContext timeout (12s) + 2s buffer
				const timeoutId = setTimeout(() => {
					// Check current state using ref to avoid stale closure
					// Only show error if UserContext is still loading and user is not ready
					if (userLoadingRef.current && !userRef.current?.id && !initialFetched.current) {
						if (process.env.NODE_ENV === 'development') {
							console.warn('[DataContext] UserContext still loading after timeout - showing error');
						}
						setLoading(false);
						setError('Unable to load user session. Please refresh the page or check your connection.');
					}
				}, 14000); // 14 second timeout (12s UserContext + 2s buffer)
				
				return () => clearTimeout(timeoutId);
			} else {
				// UserContext has resolved, but no user - this is fine, just clear loading
				// User needs to log in, but this is not an error condition
				setLoading(false);
				setError(null);
			}
		}

		// User is ready - proceed with subscription setup
		if (process.env.NODE_ENV === 'development') {
			console.log('[Realtime] 👤 User is ready, proceeding with subscription setup', {
				userId: user?.id || 'anonymous',
				hasChannel: !!channelRef.current,
				subscriptionActive: subscriptionActiveRef.current
			});
		}

		// Validate Supabase client before proceeding
		try {
			validateSupabaseClient();
			if (process.env.NODE_ENV === 'development') {
				console.log('[Realtime] ✅ Supabase client validated successfully', {
					hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
					hasKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
					userId: user?.id || 'anonymous'
				});
			}
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : 'Supabase client is not properly configured.';
			setError(errorMsg);
			setLoading(false);
			if (process.env.NODE_ENV === 'development') {
				console.error('[Realtime] ❌ Supabase client validation failed:', errorMsg, {
					hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
					hasKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
				});
			}
			return;
		}

		// Prevent multiple subscriptions - but only if we have an active and SUBSCRIBED channel
		// Check both the ref AND if we actually have a subscribed channel with confirmed subscription status
		if (subscriptionActiveRef.current && channelRef.current && subscriptionStatusRef.current === 'SUBSCRIBED') {
			const channelState = channelRef.current.state;
			// Only skip if channel is actually joined AND subscription status is SUBSCRIBED
			if (channelState === 'joined') {
				const channelName = `global-data-changes-${user?.id || 'anonymous'}`;
				if (process.env.NODE_ENV === 'development') {
					console.log('[Realtime] ⏭️ Subscription already active and subscribed, skipping setup', {
						channelName,
						hasChannel: !!channelRef.current,
						channelState,
						subscriptionStatus: subscriptionStatusRef.current,
						initialFetched: initialFetched.current
					});
				}
				// Subscription already active, but ensure initial fetch happens if not done
				if (!initialFetched.current && fetchDataRef.current && userRef.current?.id && !isFetchingRef.current) {
					// Use requestIdleCallback or setTimeout for non-blocking fetch
					const fetchTimeout = setTimeout(() => {
						if (fetchDataRef.current && userRef.current?.id && !initialFetched.current && !isFetchingRef.current) {
							fetchDataRef.current(true);
						}
					}, 100);
					return () => clearTimeout(fetchTimeout);
				}
				return;
			} else {
				// Channel exists but not in good state - clean it up and recreate
				if (process.env.NODE_ENV === 'development') {
					console.log('[Realtime] ⚠️ Channel exists but not in good state, cleaning up:', {
						channelState,
						subscriptionStatus: subscriptionStatusRef.current
					});
				}
				if (channelRef.current) {
					supabase.removeChannel(channelRef.current);
					channelRef.current = null;
				}
				subscriptionActiveRef.current = false;
				subscriptionStatusRef.current = null;
				reconnectAttemptsRef.current = 0; // Reset reconnect attempts when cleaning up
			}
		} else if (subscriptionActiveRef.current && !channelRef.current) {
			// Subscription marked as active but no channel - reset
			if (process.env.NODE_ENV === 'development') {
				console.log('[Realtime] ⚠️ Subscription marked active but no channel, resetting');
			}
			subscriptionActiveRef.current = false;
			subscriptionStatusRef.current = null;
			reconnectAttemptsRef.current = 0;
		}

		// Start initial fetch if not done yet (but don't block subscription setup)
		// This ensures data is fetched even if subscription setup is slow
		// Fetch immediately - no delay needed
		if (!initialFetched.current && !isFetchingRef.current && fetchDataRef.current && userRef.current?.id) {
			fetchDataRef.current(true);
		}
		let fetchTimeoutId: NodeJS.Timeout | null = null;

		/**
		 * REAL-TIME SUBSCRIPTIONS SETUP
		 * 
		 * This section sets up Supabase Realtime subscriptions to automatically detect
		 * database changes and update the UI in real-time without requiring page refresh.
		 * 
		 * Flow:
		 * 1. INSERT events: When a new scan with status='Pending Validation' is inserted,
		 *    it's automatically added to the scans state, which triggers:
		 *    - NotificationBell to update the unread count
		 *    - Validate page to show the new scan immediately
		 *    - Dashboard to update statistics
		 * 
		 * 2. UPDATE events: When a scan's status changes:
		 *    - If changed TO 'Pending Validation': Scan appears in notifications and Validate page
		 *    - If changed FROM 'Pending Validation' TO 'Validated'/'Corrected': 
		 *      Scan is automatically removed from Validate page (via filtering) and notification count decreases
		 * 
		 * 3. DELETE events: Scans are removed from state immediately
		 * 
		 * 4. validation_history events: When a scan is validated/corrected, the scan status
		 *    is updated in real-time, ensuring the Validate page updates automatically
		 * 
		 * Performance optimizations:
		 * - Prevents duplicate subscriptions using subscriptionActiveRef
		 * - Prevents duplicate scans in state by checking existence before adding
		 * - Returns same array reference if no changes to prevent unnecessary re-renders
		 * - Uses unique channel names per user to avoid conflicts
		 */
		
		// Use a unique channel name to avoid conflicts between multiple users/sessions
		const channelName = `global-data-changes-${user?.id || 'anonymous'}`;
		
		// Don't attempt to reconnect if we've exceeded max attempts
		if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
			if (process.env.NODE_ENV === 'development') {
				console.warn('[Realtime] ⚠️ Max reconnection attempts reached, falling back to periodic refresh', {
					attempts: reconnectAttemptsRef.current,
					maxAttempts: maxReconnectAttempts
				});
			}
			// Fallback to periodic refresh
			if (initialFetched.current && fetchDataRef.current) {
				fetchDataRef.current(false);
			}
			return;
		}
		
		// Prevent multiple simultaneous subscription attempts
		if (isSubscribingRef.current) {
			if (process.env.NODE_ENV === 'development') {
				console.log('[Realtime] ⏭️ Subscription already in progress, skipping');
			}
			return;
		}
		
		isSubscribingRef.current = true;
		
		if (process.env.NODE_ENV === 'development') {
			console.log('[Realtime] 🔌 Setting up real-time subscription...', {
				channelName,
				userId: user?.id || 'anonymous',
				isReady,
				subscriptionActive: subscriptionActiveRef.current,
				hasChannel: !!channelRef.current,
				reconnectAttempt: reconnectAttemptsRef.current
			});
		}
		
		// DON'T set subscriptionActiveRef to true yet - wait until subscription succeeds
		// This prevents the early return check from blocking retries if subscription fails
		
		// Declare uniqueChannelName before try block so it's accessible in catch block
		// Initialize with base channelName, will be updated with timestamp when channel is created
		let uniqueChannelName = channelName;
		
		try {
			// Clean up any existing channel first to prevent duplicate subscriptions
			// This is critical to avoid binding mismatch errors
			if (channelRef.current) {
				if (process.env.NODE_ENV === 'development') {
					console.log('[Realtime] 🧹 Cleaning up existing channel before creating new one');
				}
				try {
					supabase.removeChannel(channelRef.current);
				} catch (cleanupErr) {
					// Ignore cleanup errors - channel might already be removed
					if (process.env.NODE_ENV === 'development') {
						console.warn('[Realtime] Warning during channel cleanup:', cleanupErr);
					}
				}
				channelRef.current = null;
				subscriptionActiveRef.current = false;
				subscriptionStatusRef.current = null;
			}

			// Create channel with proper configuration
			// Use a unique channel name with timestamp to avoid binding conflicts
			uniqueChannelName = `${channelName}-${Date.now()}`;
			const channel = supabase.channel(uniqueChannelName, {
				config: {
					// Explicitly configure the channel to avoid binding mismatch
					broadcast: { self: false },
					presence: { key: '' },
				},
			});
			
			if (process.env.NODE_ENV === 'development') {
				console.log('[Realtime] 📡 Channel created:', uniqueChannelName);
			}
			
			// Build channel subscriptions - chain all events before subscribing
			// Subscribe to both leaf_disease_scans and fruit_ripeness_scans tables
			channel
			// Subscribe to INSERT events on leaf_disease_scans table
			.on(
				"postgres_changes",
				{ 
					event: "INSERT", 
					schema: "public", 
					table: "leaf_disease_scans"
				},
				async (payload: ScanRealtimePayload): Promise<void> => {
					const newScan = payload.new as Partial<Scan> | null;
					if (!newScan || !newScan.id) return;
					
					const scanId = newScan.id;
					
					if (process.env.NODE_ENV === 'development') {
						console.log('[Realtime] ✅ INSERT event received for leaf_disease_scans table:', {
							scanId,
							timestamp: new Date().toISOString()
						});
					}
					
					if (!scanId || typeof scanId !== 'number') {
						if (process.env.NODE_ENV === 'development') {
							console.warn('[Realtime] ⚠️ INSERT event received but scan ID is missing or invalid', payload);
						}
						return;
					}

					try {
						if (process.env.NODE_ENV === 'development') {
							console.log('[Realtime] 🔍 Fetching full scan data for ID:', scanId);
						}
						const fullScan = await fetchScanWithProfile(scanId, 'leaf_disease');
						if (fullScan) {
							// Exclude Non-Ampalaya scans from state
							if (isNonAmpalayaScan(fullScan)) {
								if (process.env.NODE_ENV === 'development') {
									console.log('[Realtime] ⏭️ Non-Ampalaya scan excluded from state:', fullScan.id);
								}
								return;
							}
							if (process.env.NODE_ENV === 'development') {
								console.log('[Realtime] ✅ Scan fetched successfully, adding to state:', {
									id: fullScan.id,
									status: fullScan.status,
									farmer: fullScan.farmer_profile?.full_name || 'Unknown'
								});
							}
							setScans((prev) => {
								const exists = prev.some((s) => s.id === fullScan.id);
								if (exists) {
									if (process.env.NODE_ENV === 'development') {
										console.log('[Realtime] ⏭️ Scan already exists in state, skipping:', fullScan.id);
									}
									return prev;
								}
								const updated = [fullScan, ...prev];
								if (process.env.NODE_ENV === 'development') {
									console.log('[Realtime] ✅ New scan added to state. Total scans:', updated.length);
								}
								return updated;
							});
						} else {
							if (fetchDataRef.current) {
								fetchDataRef.current(false);
							}
						}
					} catch (error) {
						if (process.env.NODE_ENV === 'development') {
							console.error('[Realtime] ❌ Error fetching scan after INSERT event:', error);
						}
						if (fetchDataRef.current) {
							fetchDataRef.current(false);
						}
					}
				}
			)
			// Subscribe to INSERT events on fruit_ripeness_scans table
			.on(
				"postgres_changes",
				{ 
					event: "INSERT", 
					schema: "public", 
					table: "fruit_ripeness_scans"
				},
				async (payload: ScanRealtimePayload): Promise<void> => {
					const newScan = payload.new as Partial<Scan> | null;
					if (!newScan || !newScan.id) return;
					
					const scanId = newScan.id;
					
					if (process.env.NODE_ENV === 'development') {
						console.log('[Realtime] ✅ INSERT event received for fruit_ripeness_scans table:', {
							scanId,
							timestamp: new Date().toISOString()
						});
					}
					
					if (!scanId || typeof scanId !== 'number') {
						if (process.env.NODE_ENV === 'development') {
							console.warn('[Realtime] ⚠️ INSERT event received but scan ID is missing or invalid', payload);
						}
						return;
					}

					try {
						if (process.env.NODE_ENV === 'development') {
							console.log('[Realtime] 🔍 Fetching full scan data for ID:', scanId);
						}
						const fullScan = await fetchScanWithProfile(scanId, 'fruit_maturity');
						if (fullScan) {
							// Exclude Non-Ampalaya scans from state
							if (isNonAmpalayaScan(fullScan)) {
								if (process.env.NODE_ENV === 'development') {
									console.log('[Realtime] ⏭️ Non-Ampalaya scan excluded from state:', fullScan.id);
								}
								return;
							}
							if (process.env.NODE_ENV === 'development') {
								console.log('[Realtime] ✅ Scan fetched successfully, adding to state:', {
									id: fullScan.id,
									status: fullScan.status,
									farmer: fullScan.farmer_profile?.full_name || 'Unknown'
								});
							}
							setScans((prev) => {
								const exists = prev.some((s) => s.id === fullScan.id);
								if (exists) {
									if (process.env.NODE_ENV === 'development') {
										console.log('[Realtime] ⏭️ Scan already exists in state, skipping:', fullScan.id);
									}
									return prev;
								}
								const updated = [fullScan, ...prev];
								if (process.env.NODE_ENV === 'development') {
									console.log('[Realtime] ✅ New scan added to state. Total scans:', updated.length);
								}
								return updated;
							});
						} else {
							if (fetchDataRef.current) {
								fetchDataRef.current(false);
							}
						}
					} catch (error) {
						if (process.env.NODE_ENV === 'development') {
							console.error('[Realtime] ❌ Error fetching scan after INSERT event:', error);
						}
						if (fetchDataRef.current) {
							fetchDataRef.current(false);
						}
					}
				}
			)
			// Subscribe to UPDATE events on leaf_disease_scans table
			.on(
				"postgres_changes",
				{ 
					event: "UPDATE", 
					schema: "public", 
					table: "leaf_disease_scans"
				},
				async (payload: ScanRealtimePayload): Promise<void> => {
					const updatedScan = payload.new as Partial<Scan> | null;
					if (!updatedScan || !updatedScan.id) return;
					
					const scanId = updatedScan.id;
					
					if (process.env.NODE_ENV === 'development') {
						console.log('[Realtime] 🔄 UPDATE event received for leaf_disease_scans table:', {
							scanId,
							timestamp: new Date().toISOString()
						});
					}
					
					if (!scanId || typeof scanId !== 'number') {
						if (process.env.NODE_ENV === 'development') {
							console.warn('[Realtime] ⚠️ UPDATE event received but scan ID is missing or invalid', payload);
						}
						return;
					}

					try {
						const fullScan = await fetchScanWithProfile(scanId, 'leaf_disease');
						if (fullScan) {
							// Exclude Non-Ampalaya scans from state
							if (isNonAmpalayaScan(fullScan)) {
								if (process.env.NODE_ENV === 'development') {
									console.log('[Realtime] ⏭️ Non-Ampalaya scan excluded from UPDATE:', fullScan.id);
								}
								return;
							}
							if (process.env.NODE_ENV === 'development') {
								console.log('[Realtime] ✅ Updated scan fetched, updating state:', {
									id: fullScan.id,
									status: fullScan.status
								});
							}
							setScans((prev) => {
								const index = prev.findIndex((s) => s.id === fullScan.id);
								
								if (index === -1) {
									if (fullScan.status === "Pending Validation") {
										if (process.env.NODE_ENV === 'development') {
											console.log('[Realtime] ✅ Adding new pending scan via UPDATE event');
										}
										return [fullScan, ...prev];
									}
									return prev;
								}
								
								const updated = [...prev];
								updated[index] = fullScan;
								if (process.env.NODE_ENV === 'development') {
									console.log('[Realtime] ✅ Scan updated in state');
								}
								return updated;
							});
						}
					} catch (error) {
						if (process.env.NODE_ENV === 'development') {
							console.error('[Realtime] ❌ Error fetching scan after UPDATE event:', error);
						}
						if (fetchDataRef.current) {
							fetchDataRef.current(false);
						}
					}
				}
			)
			// Subscribe to UPDATE events on fruit_ripeness_scans table
			.on(
				"postgres_changes",
				{ 
					event: "UPDATE", 
					schema: "public", 
					table: "fruit_ripeness_scans"
				},
				async (payload: ScanRealtimePayload): Promise<void> => {
					const updatedScan = payload.new as Partial<Scan> | null;
					if (!updatedScan || !updatedScan.id) return;
					
					const scanId = updatedScan.id;
					
					if (process.env.NODE_ENV === 'development') {
						console.log('[Realtime] 🔄 UPDATE event received for fruit_ripeness_scans table:', {
							scanId,
							timestamp: new Date().toISOString()
						});
					}
					
					if (!scanId || typeof scanId !== 'number') {
						if (process.env.NODE_ENV === 'development') {
							console.warn('[Realtime] ⚠️ UPDATE event received but scan ID is missing or invalid', payload);
						}
						return;
					}

					try {
						const fullScan = await fetchScanWithProfile(scanId, 'fruit_maturity');
						if (fullScan) {
							// Exclude Non-Ampalaya scans from state
							if (isNonAmpalayaScan(fullScan)) {
								if (process.env.NODE_ENV === 'development') {
									console.log('[Realtime] ⏭️ Non-Ampalaya scan excluded from UPDATE:', fullScan.id);
								}
								return;
							}
							if (process.env.NODE_ENV === 'development') {
								console.log('[Realtime] ✅ Updated scan fetched, updating state:', {
									id: fullScan.id,
									status: fullScan.status
								});
							}
							setScans((prev) => {
								const index = prev.findIndex((s) => s.id === fullScan.id);
								
								if (index === -1) {
									if (fullScan.status === "Pending Validation") {
										if (process.env.NODE_ENV === 'development') {
											console.log('[Realtime] ✅ Adding new pending scan via UPDATE event');
										}
										return [fullScan, ...prev];
									}
									return prev;
								}
								
								const updated = [...prev];
								updated[index] = fullScan;
								if (process.env.NODE_ENV === 'development') {
									console.log('[Realtime] ✅ Scan updated in state');
								}
								return updated;
							});
						}
					} catch (error) {
						if (process.env.NODE_ENV === 'development') {
							console.error('[Realtime] ❌ Error fetching scan after UPDATE event:', error);
						}
						if (fetchDataRef.current) {
							fetchDataRef.current(false);
						}
					}
				}
			)
			// Subscribe to DELETE events on leaf_disease_scans table
			.on(
				"postgres_changes",
				{ 
					event: "DELETE", 
					schema: "public", 
					table: "leaf_disease_scans"
				},
				(payload: ScanRealtimePayload): void => {
					const deletedScan = payload.old as Partial<Scan> | null;
					if (!deletedScan || !deletedScan.id) return;
					
					const scanId = deletedScan.id;
					
					if (scanId && typeof scanId === 'number') {
						if (process.env.NODE_ENV === 'development') {
							console.log('[Realtime] 🗑️ DELETE event received for leaf_disease_scans:', scanId);
						}
						setScans((prev) => {
							const filtered = prev.filter((s) => s.id !== scanId);
							if (process.env.NODE_ENV === 'development') {
								console.log('[Realtime] ✅ Scan removed from state. Remaining scans:', filtered.length);
							}
							return filtered;
						});
					}
				}
			)
			// Subscribe to DELETE events on fruit_ripeness_scans table
			.on(
				"postgres_changes",
				{ 
					event: "DELETE", 
					schema: "public", 
					table: "fruit_ripeness_scans"
				},
				(payload: ScanRealtimePayload): void => {
					const deletedScan = payload.old as Partial<Scan> | null;
					if (!deletedScan || !deletedScan.id) return;
					
					const scanId = deletedScan.id;
					
					if (scanId && typeof scanId === 'number') {
						if (process.env.NODE_ENV === 'development') {
							console.log('[Realtime] 🗑️ DELETE event received for fruit_ripeness_scans:', scanId);
						}
						setScans((prev) => {
							const filtered = prev.filter((s) => s.id !== scanId);
							if (process.env.NODE_ENV === 'development') {
								console.log('[Realtime] ✅ Scan removed from state. Remaining scans:', filtered.length);
							}
							return filtered;
						});
					}
				}
			)
			/**
			 * REAL-TIME: INSERT events on 'validation_history' table
			 * 
			 * Automatically detects when a scan is validated/corrected by an expert.
			 * This ensures:
			 * - Scan status is updated immediately in state
			 * - Validate page automatically removes the scan (filters out non-pending scans)
			 * - Notification count decreases in real-time
			 * - All users viewing the Validate page see the update instantly
			 * 
			 * This works in conjunction with the scans UPDATE event to provide
			 * real-time updates when experts mark scans as Confirmed or Corrected.
			 */
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "validation_history" },
				async (payload: ValidationHistoryRealtimePayload) => {
					// Don't block on initialFetched - real-time events should work immediately
					// Only skip if we're still in the initial loading phase and don't have user yet
					if (!isReady) return;

					const newValidation = payload.new;
					if (!newValidation || !newValidation.id) return;

					// Fetch the full validation with relations (expert profile, scan details, etc.)
					const fullValidation = await fetchValidationWithRelations(newValidation.id);
					if (fullValidation) {
						setValidationHistory((prev) => {
							// Check if validation already exists (prevent duplicates)
							if (prev.some((v) => v.id === fullValidation.id)) {
								return prev;
							}
							// Add new validation at the beginning and maintain order
							return [fullValidation, ...prev];
						});

						// Also update the corresponding scan status immediately
						// IMPORTANT: Both "Validated" and "Corrected" validation_history entries set scan status to "Validated"
						// This ensures the Validate page updates in real-time when a scan is validated/corrected
						if (fullValidation.scan_id) {
							// Find scan by scan_uuid (scan_id in validation_history is UUID)
							const scanUuid = String(fullValidation.scan_id).trim();
							setScans((prev) => {
								const index = prev.findIndex((s) => s.scan_uuid === scanUuid);
								if (index !== -1) {
									const updated = [...prev];
									updated[index] = {
										...updated[index],
										status: "Validated", // Always "Validated" for both confirm and correct actions
										expert_validation: fullValidation.expert_validation || null,
									};
									// Scan will be automatically filtered out from Validate page
									// since it no longer has status='Pending Validation'
									return updated;
								}
								return prev;
							});
						}
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "UPDATE", schema: "public", table: "validation_history" },
				async (payload: ValidationHistoryRealtimePayload) => {
					// Don't block on initialFetched - real-time events should work immediately
					if (!isReady) return;

					const updatedValidation = payload.new;
					if (!updatedValidation || !updatedValidation.id) return;

					// Fetch the full validation with relations
					const fullValidation = await fetchValidationWithRelations(updatedValidation.id);
					if (fullValidation) {
						setValidationHistory((prev) => {
							const index = prev.findIndex((v) => v.id === fullValidation.id);
							if (index === -1) {
								// Validation doesn't exist, add it
								return [fullValidation, ...prev];
							}
							// Update existing validation
							const updated = [...prev];
							updated[index] = fullValidation;
							return updated;
						});

						// Also update the corresponding scan status if needed
						// IMPORTANT: Both "Validated" and "Corrected" validation_history entries set scan status to "Validated"
						if (fullValidation.scan_id) {
							// Find scan by scan_uuid (scan_id in validation_history is UUID)
							const scanUuid = String(fullValidation.scan_id).trim();
							setScans((prev) => {
								const index = prev.findIndex((s) => s.scan_uuid === scanUuid);
								if (index !== -1) {
									const updated = [...prev];
									updated[index] = {
										...updated[index],
										status: "Validated", // Always "Validated" for both confirm and correct actions
										expert_validation: fullValidation.expert_validation || null,
									};
									return updated;
								}
								return prev;
							});
						}
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "DELETE", schema: "public", table: "validation_history" },
				(payload: ValidationHistoryRealtimePayload) => {
					// Don't block on initialFetched - real-time events should work immediately
					if (!isReady) return;

					const deletedValidation = payload.old;
					if (deletedValidation && deletedValidation.id) {
						setValidationHistory((prev) => prev.filter((v) => v.id !== deletedValidation.id));
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "profiles" },
				() => {
					// Don't block on initialFetched - real-time events should work immediately
					if (!isReady) return;
					// Increment total users count
					setTotalUsers((prev) => prev + 1);
				}
			)
			.on(
				"postgres_changes",
				{ event: "DELETE", schema: "public", table: "profiles" },
				() => {
					// Don't block on initialFetched - real-time events should work immediately
					if (!isReady) return;
					// Decrement total users count
					setTotalUsers((prev) => Math.max(0, prev - 1));
				}
			)
			.subscribe((status, err) => {
				// Update subscription status ref for tracking
				subscriptionStatusRef.current = status as typeof subscriptionStatusRef.current;
				
				if (process.env.NODE_ENV === 'development') {
					console.log('[Realtime] 📊 Subscription status changed:', {
						status,
						channelName,
						userId: user?.id || 'anonymous',
						error: err ? (typeof err === 'string' ? err : JSON.stringify(err)) : null,
						timestamp: new Date().toISOString(),
						channelState: channel.state,
						previousStatus: subscriptionStatusRef.current
					});
				}
				
				if (status === "SUBSCRIBED") {
					// Only mark as active AFTER successful subscription
					channelRef.current = channel;
					subscriptionActiveRef.current = true;
					subscriptionStatusRef.current = 'SUBSCRIBED';
					isSubscribingRef.current = false; // Reset subscription flag
					
					// Reset reconnect attempts on successful subscription
					reconnectAttemptsRef.current = 0;
					
					// Clear subscription timeout since we successfully subscribed
					if (subscriptionTimeoutRef.current) {
						clearTimeout(subscriptionTimeoutRef.current);
						subscriptionTimeoutRef.current = null;
					}
					
					// Clear any pending reconnect timeout
					if (reconnectTimeoutRef.current) {
						clearTimeout(reconnectTimeoutRef.current);
						reconnectTimeoutRef.current = null;
					}
					
					if (process.env.NODE_ENV === 'development') {
						console.log('[Realtime] ✅ SUBSCRIBED - Real-time connection active!', {
							channelName: uniqueChannelName,
							userId: user?.id || 'anonymous',
							channelState: channel.state,
							subscriptionStatus: subscriptionStatusRef.current,
							listeningTo: ['scans (INSERT/UPDATE/DELETE)', 'validation_history (INSERT/UPDATE/DELETE)', 'profiles (INSERT/DELETE)']
						});
					}
					
					// Set up health check to monitor connection
					if (healthCheckIntervalRef.current) {
						clearInterval(healthCheckIntervalRef.current);
					}
					healthCheckIntervalRef.current = setInterval(() => {
						if (channelRef.current && subscriptionActiveRef.current) {
							const channelState = channelRef.current.state;
							if (process.env.NODE_ENV === 'development') {
								console.log('[Realtime] 💓 Health check - Channel state:', channelState, {
									channelName,
									isActive: subscriptionActiveRef.current
								});
							}
							
							// If channel is closed or errored, trigger reconnection
							if (channelState === 'closed' || channelState === 'errored') {
								if (process.env.NODE_ENV === 'development') {
									console.warn('[Realtime] ⚠️ Channel state is', channelState, '- triggering reconnection');
								}
								subscriptionActiveRef.current = false;
								subscriptionStatusRef.current = null;
								
								// Trigger reconnection by clearing channel and letting useEffect recreate it
								if (channelRef.current) {
									supabase.removeChannel(channelRef.current);
									channelRef.current = null;
								}
								
								// Force re-render to trigger subscription setup
								if (fetchDataRef.current) {
									fetchDataRef.current(false);
								}
							}
						}
					}, 30000); // Check every 30 seconds (more frequent for better reliability)
				} else if (status === "CHANNEL_ERROR") {
					subscriptionStatusRef.current = 'CHANNEL_ERROR';
					isSubscribingRef.current = false; // Reset subscription flag on error
					
					// Improved error handling - extract error message from various possible formats
					let errorMessage = "";
					
					if (err) {
						if (typeof err === "string") {
							errorMessage = err;
						} else if (err instanceof Error) {
							errorMessage = err.message || "";
						} else if (typeof err === "object" && err !== null) {
							// Try to extract message from error object
							const errObj = err as Record<string, unknown>;
							errorMessage = 
								(typeof errObj.message === "string" ? errObj.message : "") ||
								(typeof errObj.error === "string" ? errObj.error : "") ||
								(typeof errObj.reason === "string" ? errObj.reason : "") ||
								(typeof errObj.toString === "function" ? errObj.toString() : "") ||
								JSON.stringify(errObj) || 
								"";
						}
					}
					
					// Normalize error message for checking
					const errorStr = errorMessage.toLowerCase();
					
					// Suppress common connection-related errors that are normal (auto-reconnect will handle them)
					const isConnectionError = 
						errorStr.includes("connection") ||
						errorStr.includes("close") ||
						errorStr.includes("disconnect") ||
						errorStr.includes("websocket") ||
						errorStr === "" ||
						errorMessage === "";
					
					// Check for binding mismatch error (this should be fixed by using separate events)
					const isBindingMismatchError = 
						errorStr.includes("mismatch") ||
						errorStr.includes("binding") ||
						errorStr.includes("server and client");
					
					// Log errors for debugging (but suppress connection errors and binding mismatch if already fixed)
					if (!isConnectionError && !isBindingMismatchError) {
						console.error('[Realtime] ❌ CHANNEL_ERROR:', errorMessage || "Connection issue", {
							channelName,
							userId: user?.id || 'anonymous',
							error: err,
							channelState: channel.state,
							reconnectAttempt: reconnectAttemptsRef.current
						});
					} else if (isBindingMismatchError) {
						// Binding mismatch - this can happen if channel configuration doesn't match
						// Clean up completely and retry with a fresh channel
						console.warn('[Realtime] ⚠️ Binding mismatch detected - cleaning up and will retry', {
							channelName: uniqueChannelName,
							userId: user?.id || 'anonymous',
							note: 'This may indicate Realtime configuration issues. Ensuring clean channel setup.'
						});
						
						// Clean up the errored channel immediately
						try {
							supabase.removeChannel(channel);
						} catch (cleanupError) {
							// Ignore cleanup errors
						}
						
						// Reset all subscription state
						subscriptionActiveRef.current = false;
						subscriptionStatusRef.current = null;
						isSubscribingRef.current = false;
						if (channelRef.current === channel) {
							channelRef.current = null;
						}
						
						// Reset reconnect attempts to allow fresh retry
						reconnectAttemptsRef.current = 0;
						
						// Clear any pending timeouts
						if (subscriptionTimeoutRef.current) {
							clearTimeout(subscriptionTimeoutRef.current);
							subscriptionTimeoutRef.current = null;
						}
						if (reconnectTimeoutRef.current) {
							clearTimeout(reconnectTimeoutRef.current);
							reconnectTimeoutRef.current = null;
						}
						
						// Trigger a refresh after a delay to allow Supabase to recover
						// This will cause useEffect to retry with a fresh channel
						setTimeout(() => {
							if (fetchDataRef.current && initialFetched.current) {
								fetchDataRef.current(false);
							}
						}, 3000); // Increased delay to ensure cleanup completes
						return;
					}
					
					// Check if error is related to Realtime not being enabled
					if (errorStr.includes("realtime") || errorStr.includes("publication") || errorStr.includes("not enabled") || errorStr.includes("permission")) {
						console.error('[Realtime] ❌ Realtime may not be enabled on your tables!', {
							message: 'Please enable Realtime on the scans and validation_history tables in your Supabase dashboard.',
							sql: [
								'ALTER PUBLICATION supabase_realtime ADD TABLE scans;',
								'ALTER PUBLICATION supabase_realtime ADD TABLE validation_history;',
								'ALTER PUBLICATION supabase_realtime ADD TABLE profiles;'
							],
							channelState: channel.state
						});
						// Don't attempt reconnection for configuration errors
						subscriptionActiveRef.current = false;
						subscriptionStatusRef.current = null;
						isSubscribingRef.current = false;
						return;
					}
					
					// Attempt reconnection for recoverable errors (but not binding mismatch)
					if (!isBindingMismatchError && reconnectAttemptsRef.current < maxReconnectAttempts) {
						reconnectAttemptsRef.current += 1;
						const reconnectDelay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 10000);
						
						console.log('[Realtime] 🔄 Scheduling reconnection attempt', reconnectAttemptsRef.current, 'of', maxReconnectAttempts, 'in', reconnectDelay, 'ms');
						
						// Clean up current channel
						try {
							supabase.removeChannel(channel);
						} catch (cleanupError) {
							// Ignore cleanup errors
						}
						if (channelRef.current === channel) {
							channelRef.current = null;
						}
						subscriptionActiveRef.current = false;
						
						// Schedule reconnection with a delay to avoid race conditions
						reconnectTimeoutRef.current = setTimeout(() => {
							reconnectTimeoutRef.current = null;
							isSubscribingRef.current = false; // Reset flag before retry
							// Force re-render to trigger subscription setup
							if (fetchDataRef.current) {
								fetchDataRef.current(false);
							}
						}, reconnectDelay);
					} else {
						// Max attempts reached - fallback to periodic refresh
						console.warn('[Realtime] ⚠️ Max reconnection attempts reached, falling back to periodic refresh');
						subscriptionActiveRef.current = false;
						subscriptionStatusRef.current = null;
						isSubscribingRef.current = false;
						if (initialFetched.current && fetchDataRef.current) {
							fetchDataRef.current(false);
						}
					}
				} else if (status === "TIMED_OUT" || status === "CLOSED") {
					subscriptionStatusRef.current = status;
					isSubscribingRef.current = false; // Reset subscription flag
					
					// CLOSED status is often temporary - Supabase will attempt to reconnect automatically
					// Only log warning for TIMED_OUT or if CLOSED persists
					if (status === "TIMED_OUT") {
						console.warn('[Realtime] ⚠️ Connection timed out:', {
							channelName,
							userId: user?.id || 'anonymous',
							message: 'Attempting to reconnect...',
							channelState: channel.state,
							reconnectAttempt: reconnectAttemptsRef.current
						});
					} else if (process.env.NODE_ENV === 'development') {
						// CLOSED is often temporary, only log in dev
						console.log('[Realtime] 🔄 Connection closed - Supabase will auto-reconnect', {
							channelName,
							channelState: channel.state
						});
					}
					
					// For CLOSED, let Supabase handle auto-reconnection
					// Only manually reconnect for TIMED_OUT or if we're not already reconnecting
					if (status === "TIMED_OUT" && reconnectAttemptsRef.current < maxReconnectAttempts && !reconnectTimeoutRef.current) {
						reconnectAttemptsRef.current += 1;
						const reconnectDelay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current - 1), 10000);
						
						console.log('[Realtime] 🔄 Scheduling reconnection attempt', reconnectAttemptsRef.current, 'of', maxReconnectAttempts, 'in', reconnectDelay, 'ms');
						
						// Clean up current channel
						try {
							if (channelRef.current) {
								supabase.removeChannel(channelRef.current);
							}
						} catch (cleanupError) {
							// Ignore cleanup errors
						}
						channelRef.current = null;
						subscriptionActiveRef.current = false;
						
						// Refresh data immediately to ensure UI is up to date
						if (initialFetched.current && fetchDataRef.current) {
							fetchDataRef.current(false);
						}
						
						// Schedule reconnection with delay
						reconnectTimeoutRef.current = setTimeout(() => {
							reconnectTimeoutRef.current = null;
							isSubscribingRef.current = false; // Reset flag before retry
							// Force re-render to trigger subscription setup
							if (fetchDataRef.current) {
								fetchDataRef.current(false);
							}
						}, reconnectDelay);
					} else if (status === "CLOSED") {
						// For CLOSED, don't immediately mark as inactive - let Supabase auto-reconnect
						// Only mark inactive if it persists
						if (channel.state === 'closed' && channelRef.current === channel) {
							// Channel is closed and not recovering - mark inactive
							subscriptionActiveRef.current = false;
							// Supabase will attempt auto-reconnect, so don't block it
						}
					} else {
						// Max attempts reached - fallback to periodic refresh
						console.warn('[Realtime] ⚠️ Max reconnection attempts reached, falling back to periodic refresh');
						subscriptionActiveRef.current = false;
						subscriptionStatusRef.current = null;
						if (initialFetched.current && fetchDataRef.current) {
							fetchDataRef.current(false);
						}
					}
				} else {
					subscriptionStatusRef.current = status as typeof subscriptionStatusRef.current;
					console.log('[Realtime] 📊 Subscription status:', status, {
						channelName,
						userId: user?.id || 'anonymous',
						channelState: channel.state,
						subscriptionStatus: subscriptionStatusRef.current
					});
					
					// If status is something unexpected and channel is not in good state, mark as inactive
					if (channel.state === 'closed' || channel.state === 'errored') {
						console.warn('[Realtime] ⚠️ Channel in bad state:', channel.state, '- marking as inactive');
						subscriptionActiveRef.current = false;
						subscriptionStatusRef.current = null;
						if (channelRef.current === channel) {
							channelRef.current = null;
						}
					}
				}
			});
			
			// Add a timeout to detect if subscription never reaches SUBSCRIBED status
			// Clear any existing timeout first
			if (subscriptionTimeoutRef.current) {
				clearTimeout(subscriptionTimeoutRef.current);
			}
			subscriptionTimeoutRef.current = setTimeout(() => {
				// Check both channel state AND subscription status
				// Only trigger timeout if channel is still the current one and not subscribed
				if (channelRef.current === channel && subscriptionStatusRef.current !== 'SUBSCRIBED') {
					isSubscribingRef.current = false; // Reset subscription flag on timeout
					
					console.warn('[Realtime] ⚠️ Subscription timeout - channel not fully subscribed after 20 seconds', {
						channelName: uniqueChannelName,
						channelState: channel.state,
						subscriptionStatus: subscriptionStatusRef.current,
						hasChannelRef: channelRef.current === channel,
						expectedStatus: 'SUBSCRIBED',
						note: 'This might be due to network issues or Supabase Realtime not being enabled. The app will continue with periodic refreshes.'
					});
					
					// Only mark inactive if channel is definitely not joining
					if (channel.state === 'closed' || channel.state === 'errored') {
						subscriptionActiveRef.current = false;
						subscriptionStatusRef.current = null;
						
						// Clean up the errored channel
						try {
							supabase.removeChannel(channel);
						} catch (cleanupError) {
							// Ignore cleanup errors
						}
						
						if (channelRef.current === channel) {
							channelRef.current = null;
						}
						
						// Reset reconnect attempts to allow fresh retry
						reconnectAttemptsRef.current = 0;
					}
					
					// Try to refresh data as fallback
					if (initialFetched.current && fetchDataRef.current) {
						if (process.env.NODE_ENV === 'development') {
							console.log('[Realtime] 🔄 Triggering data refresh as fallback after timeout');
						}
						fetchDataRef.current(false);
					}
				}
				subscriptionTimeoutRef.current = null;
			}, 20000); // 20 second timeout (increased to allow more time for subscription)
			
		} catch (error: unknown) {
			isSubscribingRef.current = false; // Reset subscription flag on error
			console.error('[Realtime] ❌ Error setting up real-time subscription:', error, {
				channelName: uniqueChannelName,
				userId: user?.id || 'anonymous',
				errorDetails: error instanceof Error ? error.message : String(error)
			});
			subscriptionActiveRef.current = false;
			subscriptionStatusRef.current = null;
			
			// Clean up channel if it was created
			// Note: channel may not exist if error occurred before channel creation
			if (channelRef.current) {
				try {
					supabase.removeChannel(channelRef.current);
				} catch (cleanupErr) {
					// Ignore cleanup errors
				}
				channelRef.current = null;
			}
			
			// Reset reconnect attempts to allow fresh retry
			reconnectAttemptsRef.current = 0;
			
			// Clear any pending timeouts
			if (subscriptionTimeoutRef.current) {
				clearTimeout(subscriptionTimeoutRef.current);
				subscriptionTimeoutRef.current = null;
			}
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
			
			// Fallback to periodic refresh
			if (initialFetched.current && fetchDataRef.current) {
				if (process.env.NODE_ENV === 'development') {
					console.log('[Realtime] 🔄 Triggering data refresh as fallback after error');
				}
				fetchDataRef.current();
			}
		}

		return () => {
			if (process.env.NODE_ENV === 'development') {
				console.log('[Realtime] 🧹 Cleaning up subscription on unmount', {
					channelName,
					hasChannel: !!channelRef.current
				});
			}
			
			// Clear initial fetch timeout if it exists
			if (fetchTimeoutId) {
				clearTimeout(fetchTimeoutId);
			}
			
			// Clear health check interval
			if (healthCheckIntervalRef.current) {
				clearInterval(healthCheckIntervalRef.current);
				healthCheckIntervalRef.current = null;
			}
			
			// Clear subscription timeout if it exists
			if (subscriptionTimeoutRef.current) {
				clearTimeout(subscriptionTimeoutRef.current);
				subscriptionTimeoutRef.current = null;
			}
			
			// Clear reconnect timeout if it exists
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
			
			// Reset reconnect attempts and subscription flag
			reconnectAttemptsRef.current = 0;
			isSubscribingRef.current = false;
			
			// Clean up channel - ensure proper removal to prevent binding mismatch
			if (channelRef.current) {
				try {
					supabase.removeChannel(channelRef.current);
				} catch (cleanupErr) {
					// Ignore cleanup errors - channel might already be removed
					if (process.env.NODE_ENV === 'development') {
						console.warn('[Realtime] Warning during channel cleanup on unmount:', cleanupErr);
					}
				}
				channelRef.current = null;
				subscriptionActiveRef.current = false;
				subscriptionStatusRef.current = null;
				if (process.env.NODE_ENV === 'development') {
					console.log('[Realtime] ✅ Channel removed and subscription deactivated');
				}
			}
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isReady, user?.id, userLoading]); // Depend on isReady, user.id, and userLoading - fetchData is accessed via ref to prevent loops

	// VISIBILITY CHANGE RECOVERY
	// When tab becomes visible after being hidden, browser may have:
	// - Throttled/paused JavaScript execution
	// - Disconnected WebSocket subscriptions
	// - Left pending fetch operations in limbo
	// This handler ensures the app recovers gracefully
	useEffect(() => {
		if (typeof document === 'undefined') return;

		let visibilityRecoveryTimeout: NodeJS.Timeout | null = null;
		let isRecovering = false;

		const handleVisibilityChange = async () => {
			// Only act when tab becomes visible
			if (document.visibilityState !== 'visible') return;

			// Prevent multiple simultaneous recovery attempts
			if (isRecovering) return;

			// Clear any pending recovery timeout
			if (visibilityRecoveryTimeout) {
				clearTimeout(visibilityRecoveryTimeout);
			}

			// Debounce the recovery to prevent rapid-fire on fast tab switches
			visibilityRecoveryTimeout = setTimeout(async () => {
				if (isRecovering) return;
				isRecovering = true;

				try {
					// CRITICAL FIX: Force-clear any stuck loading state
					// This prevents infinite loading when returning to tab
					// Use loadingRef.current to always get fresh value (avoid stale closure)
					if (loadingRef.current && !isFetchingRef.current) {
						console.log('[DataContext] Visibility change: clearing stuck loading state');
						setLoading(false);
					}

					// Skip recovery if user is not ready
					if (!userRef.current?.id) {
						isRecovering = false;
						return;
					}

					// Check if Supabase Realtime subscription is healthy
					const subscriptionHealthy = 
						channelRef.current && 
						subscriptionActiveRef.current && 
						subscriptionStatusRef.current === 'SUBSCRIBED' &&
						channelRef.current.state === 'joined';

					if (!subscriptionHealthy) {
						console.log('[DataContext] Visibility change: subscription unhealthy, will recover on next render cycle');
						// Reset subscription state to trigger re-subscription
						if (channelRef.current) {
							try {
								supabase.removeChannel(channelRef.current);
							} catch (e) {
								// Ignore cleanup errors
							}
							channelRef.current = null;
						}
						subscriptionActiveRef.current = false;
						subscriptionStatusRef.current = null;
						reconnectAttemptsRef.current = 0;
					}

					// Silently refresh data if we have been fetched before
					// This ensures data is fresh without showing loading spinner
					if (initialFetched.current && fetchDataRef.current && !isFetchingRef.current) {
						console.log('[DataContext] Visibility change: refreshing data silently');
						await fetchDataRef.current(false); // false = no spinner
					}
				} catch (err) {
					console.warn('[DataContext] Visibility recovery error:', err);
				} finally {
					isRecovering = false;
				}
			}, 300); // 300ms debounce
		};

		document.addEventListener('visibilitychange', handleVisibilityChange);

		return () => {
			if (visibilityRecoveryTimeout) {
				clearTimeout(visibilityRecoveryTimeout);
			}
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []); // Empty deps - uses refs for all mutable state

	// POLLING: Refresh data every 10 seconds as a fallback for real-time updates
	// This ensures new scans/validations appear even if WebSocket connection fails
	const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
	
	useEffect(() => {
		// Only poll when user is ready and initial fetch is complete
		if (!isReady || !initialFetched.current) {
			if (pollingIntervalRef.current) {
				clearInterval(pollingIntervalRef.current);
				pollingIntervalRef.current = null;
			}
			return;
		}

		// Start polling every 10 seconds
		pollingIntervalRef.current = setInterval(() => {
			// Only poll when page is visible and not already fetching
			if (document.visibilityState === 'visible' && !isFetchingRef.current && fetchDataRef.current) {
				fetchDataRef.current(false); // Silent refresh (no loading spinner)
			}
		}, 10000); // 10 seconds

		return () => {
			if (pollingIntervalRef.current) {
				clearInterval(pollingIntervalRef.current);
				pollingIntervalRef.current = null;
			}
		};
	}, [isReady]);

	const removeScanFromState = useCallback((scanId: number) => {
		setScans((prev) => prev.filter((scan) => scan.id !== scanId));
	}, []);

	/**
	 * Update a scan's status in local state without removing it.
	 * Used after validation so the dashboard cards reflect the change instantly
	 * while the validate page filter (status === 'Pending Validation') hides it.
	 */
	const updateScanStatusInState = useCallback((scanId: number, status: Scan['status']) => {
		setScans((prev) => {
			const index = prev.findIndex((s) => s.id === scanId);
			if (index === -1) return prev;
			const updated = [...prev];
			updated[index] = { ...updated[index], status };
			return updated;
		});
	}, []);

	// Memoize context value to prevent unnecessary re-renders
	// Use deep comparison for arrays to prevent re-renders when data hasn't actually changed
	const value: DataContextValue = useMemo(
		() => ({
			scans,
			validationHistory,
			totalUsers,
			loading,
			error,
			refreshData: fetchData,
			removeScanFromState,
			updateScanStatusInState,
		}),
		[scans, validationHistory, totalUsers, loading, error, fetchData, removeScanFromState, updateScanStatusInState]
	);

	// Clear cached data immediately when the user logs out to avoid stale flashes
	useEffect(() => {
		if (!user) {
			setScans([]);
			setValidationHistory([]);
			setTotalUsers(0);
			initialFetched.current = false;
			setLoading(false);
			setError(null);
			// Clear localStorage cache on logout
			if (typeof window !== 'undefined') {
				try {
					localStorage.removeItem(CACHE_KEY_SCANS);
					localStorage.removeItem(CACHE_KEY_VALIDATIONS);
					localStorage.removeItem(CACHE_KEY_USERS);
				} catch {
					// Ignore localStorage errors
				}
			}
		}
	}, [user]);

	return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
	const context = useContext(DataContext);
	if (!context) {
		throw new Error("useData must be used within a DataProvider");
	}
	return context;
}



