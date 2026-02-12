"use client";

import { ReactNode, createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import { Scan, getAiPrediction, UserProfile } from "../types";
import { useData } from "./DataContext";
import { supabase } from "./supabase";
import { useUser } from "./UserContext";

const READ_SCANS_STORAGE_KEY = "bs:read-scans";
const READ_USERS_STORAGE_KEY = "bs:read-pending-users";

type NotificationContextValue = {
	pendingScans: Scan[];
	pendingUsers: UserProfile[];
	unreadCount: number;
	unreadScansCount: number;
	unreadUsersCount: number;
	loading: boolean;
	error: string | null;
	refreshNotifications: () => Promise<void>;
	markScansAsRead: (scanIds: number[]) => void;
	markUsersAsRead: (userIds: string[]) => void;
	isScanRead: (scanId: number) => boolean;
	isUserRead: (userId: string) => boolean;
};

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

/**
 * Load read scan IDs from localStorage
 */
function loadReadScanIds(): Set<number> {
	if (typeof window === "undefined") return new Set();
	
	try {
		const stored = localStorage.getItem(READ_SCANS_STORAGE_KEY);
		if (!stored) return new Set();
		
		const parsed = JSON.parse(stored);
		if (Array.isArray(parsed)) {
			return new Set(parsed.filter((id): id is number => typeof id === "number"));
		}
	} catch (error) {
		if (process.env.NODE_ENV === 'development') {
			console.warn("Error loading read scan IDs from localStorage:", error);
		}
	}
	
	return new Set();
}

/**
 * Save read scan IDs to localStorage
 */
function saveReadScanIds(ids: Set<number>): void {
	if (typeof window === "undefined") return;
	
	try {
		const array = Array.from(ids);
		localStorage.setItem(READ_SCANS_STORAGE_KEY, JSON.stringify(array));
	} catch (error) {
		if (process.env.NODE_ENV === 'development') {
			console.warn("Error saving read scan IDs to localStorage:", error);
		}
	}
}

/**
 * Load read pending user IDs from localStorage
 */
function loadReadUserIds(): Set<string> {
	if (typeof window === "undefined") return new Set();
	
	try {
		const stored = localStorage.getItem(READ_USERS_STORAGE_KEY);
		if (!stored) return new Set();
		
		const parsed = JSON.parse(stored);
		if (Array.isArray(parsed)) {
			return new Set(parsed.filter((id): id is string => typeof id === "string"));
		}
	} catch (error) {
		if (process.env.NODE_ENV === 'development') {
			console.warn("Error loading read user IDs from localStorage:", error);
		}
	}
	
	return new Set();
}

/**
 * Save read pending user IDs to localStorage
 */
function saveReadUserIds(ids: Set<string>): void {
	if (typeof window === "undefined") return;
	
	try {
		const array = Array.from(ids);
		localStorage.setItem(READ_USERS_STORAGE_KEY, JSON.stringify(array));
	} catch (error) {
		if (process.env.NODE_ENV === 'development') {
			console.warn("Error saving read user IDs to localStorage:", error);
		}
	}
}

/**
 * NotificationProvider - Real-Time Notification Management
 * 
 * This context provides real-time notifications for pending scans that need validation.
 * 
 * REAL-TIME FUNCTIONALITY:
 * - Automatically updates when new scans with status='Pending Validation' are inserted
 * - Notification count updates instantly without page refresh
 * - Scans are filtered from DataContext's scans array, which updates via Supabase Realtime
 * - When scans are validated/corrected, they're automatically removed from notifications
 * 
 * How it works:
 * 1. DataContext subscribes to Supabase Realtime events (INSERT/UPDATE on 'scans' table)
 * 2. When a new scan is inserted with status='Pending Validation', it's added to scans state
 * 3. This context filters scans for 'Pending Validation' status
 * 4. Unread count is calculated (pending scans not marked as read)
 * 5. NotificationBell displays the count and updates automatically
 * 
 * When a scan is validated/corrected:
 * - Scan status changes to 'Validated' (both Confirm and Correct actions) via real-time UPDATE event
 * - Filter automatically excludes it (no longer 'Pending Validation')
 * - Unread count decreases immediately
 * - No manual refresh needed!
 * 
 * IMPORTANT: Both "Confirm" and "Correct" actions set scans.status to "Validated"
 * The validation_history table tracks whether it was "Validated" or "Corrected" for AI accuracy
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
	// Get scans from DataContext - these update automatically via Supabase Realtime subscriptions
	const { scans, loading, error, refreshData } = useData();
	// Get current user's role to filter admin-only notifications
	const { user, profile, loading: userLoading } = useUser();
	const isAdmin = profile?.role === 'admin';
	const isExpert = profile?.role === 'expert';
	// Guard: role must be fully resolved before exposing any notifications.
	// During page refresh, profile loads in the background AFTER loading=false.
	// Without this guard, isAdmin=false while profile is null → scan notifications
	// would briefly leak to admin accounts.
	const roleResolved = !user || profile !== null;
	
	const [readScanIds, setReadScanIds] = useState<Set<number>>(() => loadReadScanIds());
	const [readUserIds, setReadUserIds] = useState<Set<string>>(() => loadReadUserIds());
	const [pendingUsers, setPendingUsers] = useState<UserProfile[]>([]);
	const [usersLoading, setUsersLoading] = useState(true);

	/**
	 * REAL-TIME FILTERING: Filter scans for 'Pending Validation' status
	 * 
	 * This memoized filter ensures:
	 * - Only pending scans are included in notifications
	 * - New scans appear automatically when inserted via real-time subscriptions
	 * - Validated/corrected scans are automatically excluded
	 * - Efficient re-renders only when scans array changes
	 * 
	 * Status must match exactly: "Pending Validation" (capital P and V)
	 * This matches the database enum value and ensures only relevant scans trigger notifications.
	 */
	const pendingScans = useMemo(() => {
		if (!scans || scans.length === 0) return [];
		// Filter for scans with status = 'Pending Validation' (exact match required)
		// Also exclude scans with status = 'Unknown' or result = 'Unknown' to suppress notifications
		const pending = scans.filter((scan) => {
			// Exclude 'Unknown' status scans
			if (scan.status === 'Unknown') return false;
			// Only include pending validation scans
			if (scan.status !== "Pending Validation") return false;
			// Exclude scans with result = 'Unknown' (disease_detected or ripeness_stage)
			const result = getAiPrediction(scan);
			if (result === 'Unknown') return false;
			return true;
		});
		// Sort by created_at descending (newest first) for consistent ordering
		return pending.sort((a, b) => {
			const dateA = new Date(a.created_at).getTime();
			const dateB = new Date(b.created_at).getTime();
			return dateB - dateA;
		});
	}, [scans]);

	// Fetch pending users from profiles table - ADMIN ONLY
	// This prevents experts from seeing new user registration notifications
	useEffect(() => {
		let isMounted = true;
		
		// Skip fetching pending users if not an admin or still loading user profile
		if (!isAdmin || userLoading) {
			setUsersLoading(false);
			setPendingUsers([]); // Clear any existing pending users for non-admins
			return;
		}
		
		const fetchPendingUsers = async () => {
			try {
				setUsersLoading(true);
				const { data, error } = await supabase
					.from("profiles")
					.select("*")
					.eq("status", "pending")
					.order("created_at", { ascending: false });
				
				if (error) {
					if (process.env.NODE_ENV === 'development') {
						console.warn("Error fetching pending users:", error);
					}
					return;
				}
				
				if (isMounted && data) {
					setPendingUsers(data);
				}
			} catch (err) {
				if (process.env.NODE_ENV === 'development') {
					console.error("Error in fetchPendingUsers:", err);
				}
			} finally {
				if (isMounted) {
					setUsersLoading(false);
				}
			}
		};
		
		fetchPendingUsers();
		
		// Set up real-time subscription for profile changes - ADMIN ONLY
		// Don't subscribe if not an admin to prevent unnecessary real-time connections
		if (!isAdmin) {
			return () => {
				isMounted = false;
			};
		}
		
		const channel = supabase
			.channel('pending-users-notifications')
			.on(
				'postgres_changes',
				{
					event: 'INSERT',
					schema: 'public',
					table: 'profiles',
					filter: 'status=eq.pending'
				},
				(payload: any) => {
					if (payload.new && payload.new.id) {
						setPendingUsers((prev) => {
							// Check if user already exists
							if (prev.some(u => u.id === payload.new.id)) {
								return prev;
							}
							// Add new pending user at the beginning
							return [payload.new as UserProfile, ...prev];
						});
					}
				}
			)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'profiles'
				},
				(payload: any) => {
					if (payload.new && payload.new.id) {
						// If status changed from pending to approved/rejected, remove from list
						if (payload.new.status !== 'pending') {
							setPendingUsers((prev) => prev.filter(u => u.id !== payload.new.id));
						} else {
							// Update existing pending user
							setPendingUsers((prev) => {
								const index = prev.findIndex(u => u.id === payload.new.id);
								if (index !== -1) {
									const updated = [...prev];
									updated[index] = payload.new as UserProfile;
									return updated;
								}
								return prev;
							});
						}
					}
				}
			)
			.on(
				'postgres_changes',
				{
					event: 'DELETE',
					schema: 'public',
					table: 'profiles'
				},
				(payload: any) => {
					if (payload.old && payload.old.id) {
						setPendingUsers((prev) => prev.filter(u => u.id !== payload.old.id));
					}
				}
			)
			.subscribe();
		
		return () => {
			isMounted = false;
			supabase.removeChannel(channel);
		};
	}, [isAdmin, userLoading]);

	// Drop read markers for scans that are no longer pending and persist to localStorage
	useEffect(() => {
		setReadScanIds((prev) => {
			if (prev.size === 0) return prev;

			const pendingIds = new Set(pendingScans.map((scan) => scan.id));
			let changed = false;
			const next = new Set<number>();

			prev.forEach((id) => {
				if (pendingIds.has(id)) {
					next.add(id);
				} else {
					changed = true;
				}
			});

			if (changed) {
				saveReadScanIds(next);
				return next;
			}
			return prev;
		});
	}, [pendingScans]);

	// Drop read markers for users that are no longer pending
	useEffect(() => {
		setReadUserIds((prev) => {
			if (prev.size === 0) return prev;

			const pendingIds = new Set(pendingUsers.map((user) => user.id));
			let changed = false;
			const next = new Set<string>();

			prev.forEach((id) => {
				if (pendingIds.has(id)) {
					next.add(id);
				} else {
					changed = true;
				}
			});

			if (changed) {
				saveReadUserIds(next);
				return next;
			}
			return prev;
		});
	}, [pendingUsers]);

	const markScansAsRead = useCallback((scanIds: number[]) => {
		if (!scanIds || scanIds.length === 0) return;

		setReadScanIds((prev) => {
			let changed = false;
			const next = new Set(prev);

			scanIds.forEach((id) => {
				if (!next.has(id)) {
					next.add(id);
					changed = true;
				}
			});

			if (changed) {
				saveReadScanIds(next);
				return next;
			}
			return prev;
		});
	}, []);

	const markUsersAsRead = useCallback((userIds: string[]) => {
		if (!userIds || userIds.length === 0) return;

		setReadUserIds((prev) => {
			let changed = false;
			const next = new Set(prev);

			userIds.forEach((id) => {
				if (!next.has(id)) {
					next.add(id);
					changed = true;
				}
			});

			if (changed) {
				saveReadUserIds(next);
				return next;
			}
			return prev;
		});
	}, []);

	/**
	 * REAL-TIME UNREAD COUNT: Calculate unread notifications for scans and users
	 * 
	 * This memoized calculation ensures:
	 * - Count updates automatically when new scans/users arrive via real-time subscriptions
	 * - Count decreases when scans are validated/corrected or users are approved/rejected
	 * - Count decreases when items are marked as read
	 * - Efficient calculation only when dependencies change
	 * 
	 * The count is displayed in the NotificationBell badge and updates instantly.
	 */
	const unreadScansCount = useMemo(() => {
		if (pendingScans.length === 0) return 0;
		return pendingScans.reduce((count, scan) => (readScanIds.has(scan.id) ? count : count + 1), 0);
	}, [pendingScans, readScanIds]);

	const unreadUsersCount = useMemo(() => {
		if (pendingUsers.length === 0) return 0;
		return pendingUsers.reduce((count, user) => (readUserIds.has(user.id) ? count : count + 1), 0);
	}, [pendingUsers, readUserIds]);

	const unreadCount = useMemo(() => {
		return unreadScansCount + unreadUsersCount;
	}, [unreadScansCount, unreadUsersCount]);

	// Refresh function - just refresh the data context
	const refreshNotifications = useCallback(async () => {
		await refreshData();
	}, [refreshData]);

	// Helper function to check if a scan is read
	const isScanRead = useCallback(
		(scanId: number) => {
			return readScanIds.has(scanId);
		},
		[readScanIds]
	);

	// Helper function to check if a user is read
	const isUserRead = useCallback(
		(userId: string) => {
			return readUserIds.has(userId);
		},
		[readUserIds]
	);

	const value: NotificationContextValue = useMemo(
		() => ({
			// STRICT role-based notification filtering:
			// - While role is not yet resolved: show NOTHING (prevents cross-role data leakage)
			// - Admin: sees ONLY new user registrations pending approval (status='pending')
			// - Expert: sees ONLY new scans needing validation (status='Pending Validation')
			// - Any other role: sees nothing
			pendingScans: (roleResolved && isExpert) ? pendingScans : [],
			pendingUsers: (roleResolved && isAdmin) ? pendingUsers : [],
			unreadCount: !roleResolved ? 0 : (isAdmin ? unreadUsersCount : isExpert ? unreadScansCount : 0),
			unreadScansCount: (roleResolved && isExpert) ? unreadScansCount : 0,
			unreadUsersCount: (roleResolved && isAdmin) ? unreadUsersCount : 0,
			loading: loading || usersLoading || userLoading || !roleResolved,
			error,
			refreshNotifications,
			markScansAsRead,
			markUsersAsRead,
			isScanRead,
			isUserRead,
		}),
		[pendingScans, pendingUsers, unreadCount, unreadScansCount, unreadUsersCount, loading, usersLoading, userLoading, isAdmin, isExpert, roleResolved, error, refreshNotifications, markScansAsRead, markUsersAsRead, isScanRead, isUserRead]
	);

	return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
	const context = useContext(NotificationContext);
	if (!context) {
		throw new Error("useNotifications must be used within a NotificationProvider");
	}
	return context;
}

