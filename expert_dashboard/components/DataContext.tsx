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
	const { user } = useUser();
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
	const userRef = useRef(user);

	const isReady = useMemo(() => Boolean(user?.id), [user?.id]);
	
	// Keep user ref updated for timeout checks
	useEffect(() => {
		userRef.current = user;
	}, [user]);

	const fetchData = useCallback(
		async (showSpinner = false) => {
			if (!isReady || isFetchingRef.current) return;

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
			// Set loading to false if user is not ready after a timeout
			// This prevents infinite loading if user context never resolves
			const timeoutId = setTimeout(() => {
				// Check current state using ref to avoid stale closure
				if (!userRef.current?.id && !initialFetched.current) {
					setLoading(false);
					setError('Unable to load user session. Please refresh the page or check your connection.');
				}
			}, 10000); // 10 second timeout
			
			return () => clearTimeout(timeoutId);
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

		// Prevent multiple subscriptions
		if (subscriptionActiveRef.current) return;

		// Wait for auth/user to be ready before first fetch to avoid empty flashes
		if (!initialFetched.current) {
			// Use fetchDataRef to avoid dependency issues
			if (fetchDataRef.current) {
				fetchDataRef.current(true);
			}
		}

		// Set up real-time subscriptions with direct state updates
		// Use a unique channel name to avoid conflicts
		const channelName = `global-data-changes-${user?.id || 'anonymous'}`;
		
		try {
			// Clean up any existing channel first
			if (channelRef.current) {
				supabase.removeChannel(channelRef.current);
			}

			const channel = supabase.channel(channelName, {
				config: {
					broadcast: { self: false },
				},
			})
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
						if (process.env.NODE_ENV === "development") {
							console.warn("⚠️ INSERT event received but scan ID is missing");
						}
						return;
					}

					// Log immediately when we receive the event
					if (process.env.NODE_ENV === "development") {
						console.log("🔔 Real-time INSERT event received for scan:", newScan.id, "Status:", newScan.status);
					}

					// Only process if status is "Pending Validation"
					if (newScan.status !== "Pending Validation") {
						if (process.env.NODE_ENV === "development") {
							console.log("⏭️ Skipping scan - status is not 'Pending Validation':", newScan.status);
						}
						return;
					}

					try {
						// Fetch the full scan with profile data
						const fullScan = await fetchScanWithProfile(newScan.id);
						if (fullScan && fullScan.status === "Pending Validation") {
							setScans((prev) => {
								// Check if scan already exists (prevent duplicates)
								const exists = prev.some((s) => s.id === fullScan.id);
								if (exists) {
									if (process.env.NODE_ENV === "development") {
										console.log("⚠️ Scan already exists, skipping:", fullScan.id);
									}
									return prev; // Return same reference to prevent re-render
								}
								// Add new scan at the beginning (newest first)
								const updated = [fullScan, ...prev];
								
								// Log for debugging (only in development)
								if (process.env.NODE_ENV === "development") {
									console.log("✅ New pending scan added via real-time:", fullScan.id, "Farmer:", fullScan.farmer_profile?.full_name || "Unknown", "Total scans:", updated.length);
								}
								
								return updated;
							});
						} else if (fullScan && fullScan.status !== "Pending Validation") {
							if (process.env.NODE_ENV === "development") {
								console.log("⏭️ Scan status changed before fetch completed:", newScan.id, "Status:", fullScan.status);
							}
						}
					} catch (error) {
						console.error("Error fetching scan after INSERT event:", error);
						// Fallback: refresh all data if fetch fails
						if (fetchDataRef.current) {
							fetchDataRef.current(false);
						}
					}
				}
			)
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
					const oldScan = payload.old as Partial<Scan>;
					if (!updatedScan.id) return;

					// Check if status changed TO "Pending Validation" (triggers notification)
					const statusChangedToPending = 
						updatedScan.status === "Pending Validation" && 
						oldScan?.status !== "Pending Validation";

					// Log immediately when we receive the event
					if (process.env.NODE_ENV === "development") {
						console.log("🔔 Real-time UPDATE event received for scan:", updatedScan.id, 
							"Old status:", oldScan?.status, 
							"New status:", updatedScan.status, 
							"Changed to pending:", statusChangedToPending);
					}

					try {
						// Fetch the full scan with profile data
						const fullScan = await fetchScanWithProfile(updatedScan.id);
						if (fullScan) {
							setScans((prev) => {
								const index = prev.findIndex((s) => s.id === fullScan.id);
								
								if (index === -1) {
									// Scan doesn't exist in state yet
									// Only add if status is "Pending Validation" (for notifications)
									if (fullScan.status === "Pending Validation") {
										if (process.env.NODE_ENV === "development") {
											console.log("✅ Adding new pending scan via UPDATE event:", fullScan.id, "Farmer:", fullScan.farmer_profile?.full_name || "Unknown");
										}
										return [fullScan, ...prev];
									}
									return prev; // Don't add non-pending scans
								}
								
								// Update existing scan in place
								const updated = [...prev];
								const previousStatus = updated[index]?.status;
								updated[index] = fullScan;
								
								// Log status changes for debugging, especially when changing TO "Pending Validation"
								if (process.env.NODE_ENV === "development") {
									if (previousStatus !== fullScan.status) {
										console.log("✅ Scan status changed:", fullScan.id, previousStatus, "→", fullScan.status);
										if (statusChangedToPending) {
											console.log("🔔 Notification triggered: Scan status changed to 'Pending Validation'");
										}
									}
								}
								
								return updated;
							});
						}
					} catch (error) {
						console.error("Error fetching scan after UPDATE event:", error);
						// Fallback: refresh all data if fetch fails
						if (fetchDataRef.current) {
							fetchDataRef.current(false);
						}
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "DELETE", schema: "public", table: "scans" },
				(payload) => {
					if (!initialFetched.current) return;

					const deletedScan = payload.old as { id?: number };
					if (deletedScan.id) {
						setScans((prev) => prev.filter((s) => s.id !== deletedScan.id));
					}
				}
			)
			.on(
				"postgres_changes",
				{ event: "INSERT", schema: "public", table: "validation_history" },
				async (payload) => {
					if (!initialFetched.current) return;

					const newValidation = payload.new as Partial<ValidationHistory>;
					if (!newValidation.id) return;

					// Fetch the full validation with relations
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
				if (status === "SUBSCRIBED") {
					channelRef.current = channel;
					subscriptionActiveRef.current = true;
					if (process.env.NODE_ENV === "development") {
						console.log("✅ Real-time subscription SUBSCRIBED for scans and validations");
						console.log("📡 Listening for INSERT/UPDATE/DELETE events on 'scans' table");
						console.log("🔔 Notifications will appear automatically when new scans are added or status changes to 'Pending Validation'");
						console.log("📋 Channel name:", channelName);
					}
				} else if (status === "CHANNEL_ERROR") {
					// Improved error handling - extract error message from various possible formats
					let errorMessage = "";
					const shouldLogError = true;
					
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
					
					// Only log meaningful errors (not normal connection issues)
					if (shouldLogError && !isConnectionError && process.env.NODE_ENV === "development") {
						console.error("Error subscribing to real-time data changes:", errorMessage || "Connection issue");
						if (err && typeof err === "object") {
							console.error("Full error object:", err);
						}
					}
					
					// Check if error is related to Realtime not being enabled
					if (errorStr.includes("realtime") || errorStr.includes("publication") || errorStr.includes("not enabled") || errorStr.includes("permission")) {
						if (process.env.NODE_ENV === "development") {
							console.warn("⚠️ Realtime may not be enabled on your tables. Please enable Realtime on the 'scans' and 'validation_history' tables in your Supabase dashboard.");
						}
					}
					
					// Only mark as inactive if it's a real error (not just a connection close)
					if (!isConnectionError) {
						subscriptionActiveRef.current = false;
						// Fallback to periodic refresh if real-time fails
						if (initialFetched.current && fetchDataRef.current) {
							fetchDataRef.current();
						}
					}
					// For connection errors, let Supabase handle auto-reconnect
				} else if (status === "TIMED_OUT" || status === "CLOSED") {
					// Connection lost - Supabase will attempt to reconnect automatically
					subscriptionActiveRef.current = false;
					if (process.env.NODE_ENV === "development") {
						console.log("Real-time connection closed, will auto-reconnect");
					}
					// Refresh data when connection is lost to ensure we have latest data
					if (initialFetched.current && fetchDataRef.current) {
						fetchDataRef.current();
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
			if (channelRef.current) {
				supabase.removeChannel(channelRef.current);
				channelRef.current = null;
				subscriptionActiveRef.current = false;
			}
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isReady, user?.id, fetchData]); // Include fetchData to ensure it's available, but use ref to prevent re-subscriptions

	// Removed visibility change listener - real-time subscriptions handle updates automatically
	// This was causing notifications to only appear when tab became visible
	// Real-time WebSocket subscriptions work continuously regardless of tab visibility

	const removeScanFromState = useCallback((scanId: number) => {
		setScans((prev) => prev.filter((scan) => scan.id !== scanId));
	}, []);

	// Memoize context value to prevent unnecessary re-renders
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


