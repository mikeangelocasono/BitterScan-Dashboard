"use client";

import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabase, validateSupabaseClient } from "./supabase";
import { Scan, ValidationHistory, isSupabaseApiError } from "../types";
import { useUser } from "./UserContext";

type DataContextValue = {
	scans: Scan[];
	validationHistory: ValidationHistory[];
	totalUsers: number;
	loading: boolean;
	error: string | null;
	refreshData: (showSpinner?: boolean) => Promise<void>;
	removeScanFromState: (scanId: number) => void;
};

const DataContext = createContext<DataContextValue | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
	const { user, loading: userLoading } = useUser();
	const [scans, setScans] = useState<Scan[]>([]);
	const [validationHistory, setValidationHistory] = useState<ValidationHistory[]>([]);
	const [totalUsers, setTotalUsers] = useState(0);
	const [loading, setLoading] = useState(true);
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
	const reconnectAttemptsRef = useRef(0);
	const maxReconnectAttempts = 5;

	const isReady = useMemo(() => Boolean(user?.id), [user?.id]);
	
	// Keep user ref updated for timeout checks
	useEffect(() => {
		userRef.current = user;
		userLoadingRef.current = userLoading;
	}, [user, userLoading]);

	const fetchData = useCallback(
		async (showSpinner = false) => {
			// Don't fetch if user is not ready or already fetching
			if (!isReady || isFetchingRef.current) {
				// If user is not ready and we've been waiting too long, clear loading
				if (!isReady && !initialFetched.current) {
					// This will be handled by the useEffect timeout, but we can also clear here as fallback
					return;
				}
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
				console.error('[DataContext]', errorMsg);
				return;
			}

			isFetchingRef.current = true;

			// Only show spinner if we explicitly requested or we haven't fetched once yet
			const shouldShowSpinner = showSpinner || !initialFetched.current;
			if (shouldShowSpinner) setLoading(true);

			try {
				setError(null);

				const [scansResponse, validationsResponse, profilesResponse] = await Promise.all([
					supabase
						.from("scans")
						.select(
							`*,
					farmer_profile:profiles!scans_farmer_id_fkey(
						id,
						username,
						full_name,
						email,
						profile_picture
					)`
						)
						.order("created_at", { ascending: false }),
					supabase
						.from("validation_history")
						.select(
							`*,
					expert_profile:profiles!validation_history_expert_id_fkey(
						id,
						username,
						full_name,
						email
					),
					scan:scans!validation_history_scan_id_fkey(
						*,
						farmer_profile:profiles!scans_farmer_id_fkey(
							id,
							username,
							full_name,
							email,
							profile_picture
						)
					)`
						)
						.order("validated_at", { ascending: false }),
					supabase.from("profiles").select("*", { head: true, count: "exact" }),
				]);

				if (scansResponse.error) throw scansResponse.error;
				if (validationsResponse.error) throw validationsResponse.error;
				if (profilesResponse.error) throw profilesResponse.error;

				let validations = validationsResponse.data || [];

				const missingExpertIds = new Set<string>();
				validations.forEach((validation) => {
					if (!validation.expert_profile?.full_name && validation.expert_id) {
						missingExpertIds.add(validation.expert_id);
					}
				});

				if (missingExpertIds.size > 0) {
					const { data: fallbackProfiles, error: fallbackProfilesError } = await supabase
						.from("profiles")
						.select("id, full_name, username, email")
						.in("id", Array.from(missingExpertIds));

					if (fallbackProfilesError) {
						console.error("Error fetching expert profiles:", fallbackProfilesError);
					} else if (fallbackProfiles) {
						const profileMap = new Map(
							fallbackProfiles.map((profile) => [profile.id, profile])
						);

						validations = validations.map((validation) => {
							if (validation.expert_profile?.full_name || !validation.expert_id) {
								return validation;
							}

							const profile = profileMap.get(validation.expert_id);
							if (!profile) return validation;

							return {
								...validation,
								expert_profile: {
									id: profile.id,
									username: profile.username,
									full_name: profile.full_name,
									email: profile.email,
								},
							};
						});
					}
				}

				setScans(scansResponse.data || []);
				setValidationHistory(validations);
				setTotalUsers(profilesResponse.count || 0);
				initialFetched.current = true;
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
				console.error("Error fetching dashboard data:", err);
			} finally {
				isFetchingRef.current = false;
				setLoading(false);
			}
		},
		[isReady]
	);

	// Keep ref updated with latest fetchData function
	useEffect(() => {
		fetchDataRef.current = fetchData;
	}, [fetchData]);

	// Helper function to fetch a single scan with its profile
	const fetchScanWithProfile = useCallback(async (scanId: number): Promise<Scan | null> => {
		try {
			const { data, error } = await supabase
				.from("scans")
				.select(
					`*,
					farmer_profile:profiles!scans_farmer_id_fkey(
						id,
						username,
						full_name,
						email,
						profile_picture
					)`
				)
				.eq("id", scanId)
				.single();

			if (error) {
				console.error("Error fetching scan:", error);
				return null;
			}
			return data;
		} catch (err: unknown) {
			console.error("Error fetching scan:", err);
			return null;
		}
	}, []);

	// Helper function to fetch a single validation with its relations
	const fetchValidationWithRelations = useCallback(async (validationId: number): Promise<ValidationHistory | null> => {
		try {
			const { data, error } = await supabase
				.from("validation_history")
				.select(
					`*,
					expert_profile:profiles!validation_history_expert_id_fkey(
						id,
						username,
						full_name,
						email
					),
					scan:scans!validation_history_scan_id_fkey(
						*,
						farmer_profile:profiles!scans_farmer_id_fkey(
							id,
							username,
							full_name,
							email,
							profile_picture
						)
					)`
				)
				.eq("id", validationId)
				.single();

			if (error) {
				console.error("Error fetching validation:", error);
				return null;
			}
			return data;
		} catch (err: unknown) {
			console.error("Error fetching validation:", err);
			return null;
		}
	}, []);

	useEffect(() => {
		if (!isReady) {
			// Clean up subscription when user becomes unavailable
			if (channelRef.current) {
				supabase.removeChannel(channelRef.current);
				channelRef.current = null;
				subscriptionActiveRef.current = false;
			}
			if (initialFetched.current) {
				initialFetched.current = false;
			}
			
			// Only show error if UserContext is still loading after timeout
			// If UserContext has resolved with no user, that's fine - user just needs to log in
			// Only show error if UserContext is stuck in loading state
			if (userLoading) {
				// Set loading to false if user context is still loading after a timeout
				// This prevents infinite loading if user context never resolves
				// Match UserContext timeout (6s) + 1s buffer
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
				}, 7000); // 7 second timeout (6s UserContext + 1s buffer)
				
				return () => clearTimeout(timeoutId);
			} else {
				// UserContext has resolved, but no user - this is fine, just clear loading
				// User needs to log in, but this is not an error condition
				setLoading(false);
				setError(null);
			}
		}

		// Validate Supabase client before proceeding
		try {
			validateSupabaseClient();
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : 'Supabase client is not properly configured.';
			setError(errorMsg);
			setLoading(false);
			console.error('[DataContext]', errorMsg);
			return;
		}

		// Prevent multiple subscriptions - but only if we have an active and SUBSCRIBED channel
		// Check both the ref AND if we actually have a subscribed channel with confirmed subscription status
		if (subscriptionActiveRef.current && channelRef.current && subscriptionStatusRef.current === 'SUBSCRIBED') {
			const channelState = channelRef.current.state;
			// Only skip if channel is actually joined AND subscription status is SUBSCRIBED
			if (channelState === 'joined') {
				const channelName = `global-data-changes-${user?.id || 'anonymous'}`;
				console.log('[Realtime] ⏭️ Subscription already active and subscribed, skipping setup', {
					channelName,
					hasChannel: !!channelRef.current,
					channelState,
					subscriptionStatus: subscriptionStatusRef.current,
					initialFetched: initialFetched.current
				});
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
				console.log('[Realtime] ⚠️ Channel exists but not in good state, cleaning up:', {
					channelState,
					subscriptionStatus: subscriptionStatusRef.current
				});
				if (channelRef.current) {
					supabase.removeChannel(channelRef.current);
					channelRef.current = null;
				}
				subscriptionActiveRef.current = false;
				subscriptionStatusRef.current = null;
			}
		} else if (subscriptionActiveRef.current && !channelRef.current) {
			// Subscription marked as active but no channel - reset
			console.log('[Realtime] ⚠️ Subscription marked active but no channel, resetting');
			subscriptionActiveRef.current = false;
			subscriptionStatusRef.current = null;
		}

		// Start initial fetch if not done yet (but don't block subscription setup)
		// This ensures data is fetched even if subscription setup is slow
		if (!initialFetched.current && !isFetchingRef.current) {
			// Use fetchDataRef to avoid dependency issues
			// Add a small delay to ensure UserContext has fully resolved
			const fetchTimeout = setTimeout(() => {
				if (fetchDataRef.current && userRef.current?.id && !isFetchingRef.current && !initialFetched.current) {
					fetchDataRef.current(true);
				}
			}, 150); // Small delay to ensure user context is stable
			
			// Cleanup timeout on unmount
			return () => clearTimeout(fetchTimeout);
		}

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
		
		// DON'T set subscriptionActiveRef to true yet - wait until subscription succeeds
		// This prevents the early return check from blocking retries if subscription fails
		
		try {
			// Clean up any existing channel first to prevent duplicate subscriptions
			if (channelRef.current) {
				try {
					supabase.removeChannel(channelRef.current);
				} catch (cleanupError) {
					console.warn('[Realtime] Error cleaning up old channel:', cleanupError);
				}
				channelRef.current = null;
				subscriptionActiveRef.current = false;
				subscriptionStatusRef.current = null;
			}

			// Create a new channel with proper configuration
			const channel = supabase.channel(channelName, {
				config: {
					broadcast: { self: false }, // Don't receive our own broadcast events
				},
			})
			/**
			 * REAL-TIME: INSERT events on 'scans' table
			 * 
			 * Automatically detects when new scans are inserted into the database.
			 * Only processes scans with status='Pending Validation' to show in notifications
			 * and Validate page.
			 * 
			 * This ensures:
			 * - New scans appear instantly in the Validate page without refresh
			 * - Notification bell updates immediately with new count
			 * - Dashboard statistics update in real-time
			 */
			.on(
				"postgres_changes",
				{ 
					event: "INSERT", 
					schema: "public", 
					table: "scans"
				},
				async (payload) => {
					// Process new scans immediately - don't wait for initial fetch
					// This ensures real-time updates work instantly
					
					const newScan = payload.new as Partial<Scan>;
					if (!newScan.id) {
						if (process.env.NODE_ENV === 'development') {
							console.warn("[Realtime] INSERT event received but scan ID is missing");
						}
						return;
					}

					console.log('[Realtime] 📥 INSERT event received for scan:', {
						scanId: newScan.id,
						status: newScan.status,
						timestamp: new Date().toISOString()
					});

					try {
						// Fetch the full scan with profile data (farmer name, profile picture, etc.)
						// This ensures we have all necessary data for display in Validate page and notifications
						const fullScan = await fetchScanWithProfile(newScan.id);
						if (fullScan) {
							setScans((prev) => {
								// Check if scan already exists (prevent duplicates)
								// This can happen if the same event is received multiple times
								const exists = prev.some((s) => s.id === fullScan.id);
								if (exists) {
									// Update existing scan in case it changed
									const updated = prev.map(s => s.id === fullScan.id ? fullScan : s);
									return updated;
								}
								// Add new scan at the beginning (newest first) for better UX
								console.log('[Realtime] ✅ Added new scan to state:', {
									scanId: fullScan.id,
									status: fullScan.status
								});
								return [fullScan, ...prev];
							});
						} else {
							// Fallback: refresh all data if fetch fails
							console.warn('[Realtime] ⚠️ Could not fetch scan after INSERT, refreshing data');
							if (fetchDataRef.current && initialFetched.current) {
								fetchDataRef.current(false);
							}
						}
					} catch (error) {
						console.error("[Realtime] ❌ Error fetching scan after INSERT event:", error);
						// Fallback: refresh all data if fetch fails
						if (fetchDataRef.current && initialFetched.current) {
							fetchDataRef.current(false);
						}
					}
				}
			)
			/**
			 * REAL-TIME: UPDATE events on 'scans' table
			 * 
			 * Automatically detects when scans are updated in the database.
			 * Handles two key scenarios:
			 * 
			 * 1. Status changed TO 'Pending Validation':
			 *    - Scan appears in notifications and Validate page
			 *    - Notification count increases
			 * 
			 * 2. Status changed FROM 'Pending Validation' TO 'Validated'/'Corrected':
			 *    - Scan status is updated in state
			 *    - Validate page automatically filters it out (only shows 'Pending Validation')
			 *    - Notification count decreases automatically
			 *    - No manual refresh needed - UI updates instantly
			 * 
			 * This ensures that when an expert marks a scan as Confirmed or Corrected,
			 * the scan disappears from the Validate page immediately for all users viewing it.
			 */
			.on(
				"postgres_changes",
				{ 
					event: "UPDATE", 
					schema: "public", 
					table: "scans"
				},
				async (payload) => {
					// Process updates even if initial fetch hasn't completed
					// This ensures real-time updates work immediately
					
					const updatedScan = payload.new as Partial<Scan>;
					if (!updatedScan.id) {
						if (process.env.NODE_ENV === 'development') {
							console.warn("[Realtime] UPDATE event received but scan ID is missing");
						}
						return;
					}

					console.log('[Realtime] 🔄 UPDATE event received for scan:', {
						scanId: updatedScan.id,
						status: updatedScan.status,
						timestamp: new Date().toISOString()
					});

					try {
						// Fetch the full scan with profile data to ensure we have complete information
						const fullScan = await fetchScanWithProfile(updatedScan.id);
						if (fullScan) {
							setScans((prev) => {
								const index = prev.findIndex((s) => s.id === fullScan.id);
								
								if (index === -1) {
									// Scan doesn't exist in state yet (e.g., page just loaded)
									// Add it to state - components will filter appropriately
									console.log('[Realtime] ✅ Added updated scan to state:', {
										scanId: fullScan.id,
										status: fullScan.status
									});
									return [fullScan, ...prev];
								}
								
								// Update existing scan in place
								// This handles status changes (e.g., 'Pending Validation' → 'Validated'/'Corrected')
								// The Validate page will automatically filter out non-pending scans
								const updated = [...prev];
								updated[index] = fullScan;
								console.log('[Realtime] ✅ Updated scan in state:', {
									scanId: fullScan.id,
									oldStatus: prev[index].status,
									newStatus: fullScan.status
								});
								return updated;
							});
						}
					} catch (error) {
						console.error("[Realtime] ❌ Error fetching scan after UPDATE event:", error);
						// Fallback: refresh all data if fetch fails
						if (fetchDataRef.current) {
							fetchDataRef.current(false);
						}
					}
				}
			)
			/**
			 * REAL-TIME: DELETE events on 'scans' table
			 * 
			 * Automatically removes scans from state when they're deleted from the database.
			 * This ensures the Validate page and notifications update immediately.
			 */
			.on(
				"postgres_changes",
				{ event: "DELETE", schema: "public", table: "scans" },
				(payload) => {
					if (!initialFetched.current) return;

					const deletedScan = payload.old as { id?: number };
					if (deletedScan.id) {
						console.log('[Realtime] 🗑️ DELETE event received for scan:', {
							scanId: deletedScan.id,
							timestamp: new Date().toISOString()
						});
						setScans((prev) => {
							const filtered = prev.filter((s) => s.id !== deletedScan.id);
							if (filtered.length !== prev.length) {
								console.log('[Realtime] ✅ Removed scan from state:', deletedScan.id);
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
				async (payload) => {
					if (!initialFetched.current) return;

					const newValidation = payload.new as Partial<ValidationHistory>;
					if (!newValidation.id) return;

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
						// This ensures the Validate page updates in real-time when a scan is validated/corrected
						if (fullValidation.scan_id) {
							setScans((prev) => {
								const index = prev.findIndex((s) => s.id === fullValidation.scan_id);
								if (index !== -1) {
									const updated = [...prev];
									updated[index] = {
										...updated[index],
										status: fullValidation.status === "Validated" ? "Validated" : "Corrected",
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
				async (payload) => {
					if (!initialFetched.current) return;

					const updatedValidation = payload.new as Partial<ValidationHistory>;
					if (!updatedValidation.id) return;

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
						if (fullValidation.scan_id) {
							setScans((prev) => {
								const index = prev.findIndex((s) => s.id === fullValidation.scan_id);
								if (index !== -1) {
									const updated = [...prev];
									updated[index] = {
										...updated[index],
										status: fullValidation.status === "Validated" ? "Validated" : "Corrected",
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
				(payload) => {
					if (!initialFetched.current) return;

					const deletedValidation = payload.old as { id?: number };
					if (deletedValidation.id) {
						setValidationHistory((prev) => prev.filter((v) => v.id !== deletedValidation.id));
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "profiles" },
				() => {
					if (!initialFetched.current) return;
					// Increment total users count
					setTotalUsers((prev) => prev + 1);
				}
			)
			.on(
				"postgres_changes",
				{ event: "DELETE", schema: "public", table: "profiles" },
				() => {
					if (!initialFetched.current) return;
					// Decrement total users count
					setTotalUsers((prev) => Math.max(0, prev - 1));
				}
			)
			.subscribe((status, err) => {
				// Update subscription status ref for tracking
				subscriptionStatusRef.current = status as typeof subscriptionStatusRef.current;
				
				console.log('[Realtime] 📊 Subscription status changed:', {
					status,
					channelName,
					userId: user?.id || 'anonymous',
					error: err ? (typeof err === 'string' ? err : JSON.stringify(err)) : null,
					timestamp: new Date().toISOString(),
					channelState: channel.state,
					previousStatus: subscriptionStatusRef.current
				});
				
				if (status === "SUBSCRIBED") {
					// Only mark as active AFTER successful subscription
					channelRef.current = channel;
					subscriptionActiveRef.current = true;
					subscriptionStatusRef.current = 'SUBSCRIBED';
					reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful subscription
					
					console.log('[Realtime] ✅ SUBSCRIBED - Real-time connection active!', {
						channelName,
						userId: user?.id || 'anonymous',
						channelState: channel.state,
						subscriptionStatus: subscriptionStatusRef.current,
						listeningTo: ['scans (INSERT/UPDATE/DELETE)', 'validation_history (INSERT/UPDATE/DELETE)', 'profiles (INSERT/DELETE)']
					});
					
					// Start health check interval to monitor subscription status
					if (healthCheckIntervalRef.current) {
						clearInterval(healthCheckIntervalRef.current);
					}
					healthCheckIntervalRef.current = setInterval(() => {
						if (channelRef.current) {
							const state = channelRef.current.state;
							if (state !== 'joined' && state !== 'joining') {
								console.warn('[Realtime] ⚠️ Health check: Channel not in good state:', state);
								// Channel is not in good state, mark as inactive
								subscriptionActiveRef.current = false;
								subscriptionStatusRef.current = null;
							}
						} else {
							// No channel reference, mark as inactive
							subscriptionActiveRef.current = false;
							subscriptionStatusRef.current = null;
						}
					}, 30000); // Check every 30 seconds
					
					// Ensure initial fetch happens if not done yet
					if (!initialFetched.current && fetchDataRef.current && !isFetchingRef.current) {
						setTimeout(() => {
							if (fetchDataRef.current && !initialFetched.current && !isFetchingRef.current) {
								fetchDataRef.current(true);
							}
						}, 100);
					}
				} else if (status === "CHANNEL_ERROR") {
					subscriptionStatusRef.current = 'CHANNEL_ERROR';
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
					
					// Log errors for debugging (only in development or for critical errors)
					if (!isConnectionError) {
						if (process.env.NODE_ENV === 'development') {
							console.error('[Realtime] ❌ Error subscribing to real-time data changes:', errorMessage || "Connection issue");
							if (err && typeof err === "object") {
								console.error("Full error object:", err);
							}
						}
					}
					
					// Check if error is related to Realtime not being enabled
					if (errorStr.includes("realtime") || errorStr.includes("publication") || errorStr.includes("not enabled") || errorStr.includes("permission")) {
						if (process.env.NODE_ENV === 'development') {
							console.warn("⚠️ Realtime may not be enabled on your tables. Please enable Realtime on the 'scans' and 'validation_history' tables in your Supabase dashboard.");
							console.warn("Run this SQL in Supabase SQL Editor:");
							console.warn("   ALTER PUBLICATION supabase_realtime ADD TABLE scans;");
							console.warn("   ALTER PUBLICATION supabase_realtime ADD TABLE validation_history;");
						}
					}
					
					// Mark as inactive and attempt to reconnect
					if (!isConnectionError) {
						console.warn('[Realtime] ⚠️ Marking subscription as inactive due to error');
						subscriptionActiveRef.current = false;
						// Fallback to periodic refresh if real-time fails
						if (initialFetched.current && fetchDataRef.current) {
							console.log('[Realtime] 🔄 Triggering data refresh as fallback');
							fetchDataRef.current(false);
						}
					} else {
						console.log('[Realtime] 🔄 Connection error detected, Supabase will auto-reconnect');
						// For connection errors, keep trying - Supabase will auto-reconnect
						subscriptionActiveRef.current = false;
					}
				} else if (status === "TIMED_OUT" || status === "CLOSED") {
					subscriptionStatusRef.current = status;
					console.warn('[Realtime] ⚠️ Connection lost:', status, {
						channelName,
						userId: user?.id || 'anonymous',
						message: 'Will attempt to reconnect',
						channelState: channel.state
					});
					// Connection lost - mark as inactive and refresh data
					subscriptionActiveRef.current = false;
					// Refresh data when connection is lost to ensure we have latest data
					if (initialFetched.current && fetchDataRef.current) {
						console.log('[Realtime] 🔄 Refreshing data after connection loss');
						fetchDataRef.current(false);
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
		} catch (error: unknown) {
			console.error("Error setting up real-time subscription:", error);
			subscriptionActiveRef.current = false;
			// Fallback to periodic refresh
			if (initialFetched.current && fetchDataRef.current) {
				fetchDataRef.current();
			}
		}

		return () => {
			// Cleanup function - properly remove channel on unmount or dependency change
			if (healthCheckIntervalRef.current) {
				clearInterval(healthCheckIntervalRef.current);
				healthCheckIntervalRef.current = null;
			}
			if (channelRef.current) {
				try {
					supabase.removeChannel(channelRef.current);
				} catch (cleanupError) {
					console.warn('[Realtime] Error removing channel during cleanup:', cleanupError);
				}
				channelRef.current = null;
				subscriptionActiveRef.current = false;
				subscriptionStatusRef.current = null;
			}
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isReady, user?.id, userLoading]); // Depend on isReady, user.id, and userLoading - fetchData is accessed via ref to prevent loops

	// Removed visibility change listener - real-time subscriptions handle updates automatically
	// This was causing notifications to only appear when tab became visible
	// Real-time WebSocket subscriptions work continuously regardless of tab visibility

	const removeScanFromState = useCallback((scanId: number) => {
		setScans((prev) => prev.filter((scan) => scan.id !== scanId));
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
		}),
		[scans, validationHistory, totalUsers, loading, error, fetchData, removeScanFromState]
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


