"use client";

import { ReactNode, createContext, useContext, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { Scan, getAiPrediction, UserProfile } from "../types";
import { useData } from "./DataContext";
import { supabase } from "./supabase";
import { useUser } from "./UserContext";

const READ_SCANS_STORAGE_KEY = "bs:read-scans";
const READ_USERS_STORAGE_KEY = "bs:read-pending-users";

/** Filter type for notification lists — "all" | "unread" | "read" */
export type NotificationFilter = "all" | "unread" | "read";

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
	/** Mark every pending scan + user as read in one action */
	markAllAsRead: () => void;
	isScanRead: (scanId: number) => boolean;
	isUserRead: (userId: string) => boolean;
};

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

// ─── User-scoped localStorage helpers ────────────────────────────────────
// Keys are scoped to the authenticated user's ID so different users on the
// same browser never share read-state and logging out / in doesn't leak data.

function scopedKey(base: string, userId?: string): string {
	return userId ? `${base}:${userId}` : base;
}

function loadReadScanIds(userId?: string): Set<number> {
	if (typeof window === "undefined") return new Set();

	try {
		const stored = localStorage.getItem(scopedKey(READ_SCANS_STORAGE_KEY, userId));
		if (!stored) return new Set();

		const parsed = JSON.parse(stored);
		if (Array.isArray(parsed)) {
			return new Set(parsed.filter((id): id is number => typeof id === "number"));
		}
	} catch (error) {
		if (process.env.NODE_ENV === "development") {
			console.warn("Error loading read scan IDs from localStorage:", error);
		}
	}

	return new Set();
}

function saveReadScanIds(ids: Set<number>, userId?: string): void {
	if (typeof window === "undefined") return;

	try {
		localStorage.setItem(scopedKey(READ_SCANS_STORAGE_KEY, userId), JSON.stringify(Array.from(ids)));
	} catch (error) {
		if (process.env.NODE_ENV === "development") {
			console.warn("Error saving read scan IDs to localStorage:", error);
		}
	}
}

function loadReadUserIds(userId?: string): Set<string> {
	if (typeof window === "undefined") return new Set();

	try {
		const stored = localStorage.getItem(scopedKey(READ_USERS_STORAGE_KEY, userId));
		if (!stored) return new Set();

		const parsed = JSON.parse(stored);
		if (Array.isArray(parsed)) {
			return new Set(parsed.filter((id): id is string => typeof id === "string"));
		}
	} catch (error) {
		if (process.env.NODE_ENV === "development") {
			console.warn("Error loading read user IDs from localStorage:", error);
		}
	}

	return new Set();
}

function saveReadUserIds(ids: Set<string>, userId?: string): void {
	if (typeof window === "undefined") return;

	try {
		localStorage.setItem(scopedKey(READ_USERS_STORAGE_KEY, userId), JSON.stringify(Array.from(ids)));
	} catch (error) {
		if (process.env.NODE_ENV === "development") {
			console.warn("Error saving read user IDs to localStorage:", error);
		}
	}
}

// ─── Database persistence helpers ────────────────────────────────────────
// Reads / writes to the `notification_reads` table in Supabase so read-state
// survives across browsers, devices, and cache clears.
// Falls back silently to localStorage if the table doesn't exist yet.
//
// To create the table run this SQL in your Supabase SQL editor:
//
//   CREATE TABLE IF NOT EXISTS notification_reads (
//     user_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
//     read_scan_ids JSONB NOT NULL DEFAULT '[]',
//     read_user_ids JSONB NOT NULL DEFAULT '[]',
//     updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
//   );
//   ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "Users manage own reads"
//     ON notification_reads FOR ALL
//     USING (auth.uid() = user_id)
//     WITH CHECK (auth.uid() = user_id);

async function loadReadsFromDb(
	userId: string
): Promise<{ scanIds: Set<number>; userIds: Set<string> } | null> {
	try {
		const { data, error } = await supabase
			.from("notification_reads")
			.select("read_scan_ids, read_user_ids")
			.eq("user_id", userId)
			.maybeSingle();

		if (error || !data) return null;

		const scanIds = new Set<number>(
			Array.isArray(data.read_scan_ids)
				? (data.read_scan_ids as number[]).filter((id): id is number => typeof id === "number")
				: []
		);
		const userIds = new Set<string>(
			Array.isArray(data.read_user_ids)
				? (data.read_user_ids as string[]).filter((id): id is string => typeof id === "string")
				: []
		);

		return { scanIds, userIds };
	} catch {
		// Table probably doesn't exist — fall back to localStorage silently
		return null;
	}
}

async function saveReadsToDb(
	userId: string,
	scanIds: Set<number>,
	userIds: Set<string>
): Promise<void> {
	try {
		await supabase.from("notification_reads").upsert(
			{
				user_id: userId,
				read_scan_ids: Array.from(scanIds),
				read_user_ids: Array.from(userIds),
				updated_at: new Date().toISOString(),
			},
			{ onConflict: "user_id" }
		);
	} catch {
		// Silent — localStorage is the fast fallback
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
	// Get current user's role to filter notifications.
	// Use profile.role (database) as primary, with user_metadata.role (JWT/session)
	// as immediate fallback during page refresh when profile hasn't loaded yet.
	// This prevents both infinite loading AND cross-role data leakage.
	const { user, profile, loading: userLoading } = useUser();
	const userRole = profile?.role || user?.user_metadata?.role;
	const isAdmin = userRole === 'admin';
	const isExpert = userRole === 'expert';
	
	// Read state — starts empty; populated from DB / localStorage once user is resolved.
	// This avoids the old bug where cleanup effects would wipe localStorage before data arrived.
	const [readScanIds, setReadScanIds] = useState<Set<number>>(new Set());
	const [readUserIds, setReadUserIds] = useState<Set<string>>(new Set());
	const [readStateLoaded, setReadStateLoaded] = useState(false);
	const [pendingUsers, setPendingUsers] = useState<UserProfile[]>([]);
	const [usersLoading, setUsersLoading] = useState(true);

	// ─── Load persisted read state (DB first → localStorage fallback) ────
	useEffect(() => {
		if (!user?.id || userLoading) return;
		let cancelled = false;

		(async () => {
			// 1. Try the database (cross-device, authoritative)
			const dbResult = await loadReadsFromDb(user.id);

			if (cancelled) return;

			if (dbResult) {
				setReadScanIds(dbResult.scanIds);
				setReadUserIds(dbResult.userIds);
				// Mirror to localStorage for instant hydration on next page load
				saveReadScanIds(dbResult.scanIds, user.id);
				saveReadUserIds(dbResult.userIds, user.id);
			} else {
				// 2. Fallback: user-scoped localStorage
				setReadScanIds(loadReadScanIds(user.id));
				setReadUserIds(loadReadUserIds(user.id));
			}

			setReadStateLoaded(true);
		})();

		return () => {
			cancelled = true;
		};
	}, [user?.id, userLoading]);

	// ─── Centralised persistence (localStorage + debounced DB write) ─────
	// Every change to readScanIds / readUserIds flows through here, so the
	// individual mark* / cleanup functions never call save helpers directly.
	const dbSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Keep latest values in refs so the flush-on-unmount can access them
	// without stale closures.
	const latestReadScanIds = useRef(readScanIds);
	const latestReadUserIds = useRef(readUserIds);
	const latestUserId = useRef(user?.id);
	latestReadScanIds.current = readScanIds;
	latestReadUserIds.current = readUserIds;
	latestUserId.current = user?.id;

	useEffect(() => {
		if (!readStateLoaded || !user?.id) return;

		// Immediate localStorage write (synchronous, fast)
		saveReadScanIds(readScanIds, user.id);
		saveReadUserIds(readUserIds, user.id);

		// Debounced DB write – avoids hammering the database on rapid clicks
		if (dbSaveTimer.current) clearTimeout(dbSaveTimer.current);
		dbSaveTimer.current = setTimeout(() => {
			saveReadsToDb(user.id, readScanIds, readUserIds);
		}, 500);

		return () => {
			// Flush the pending DB write on unmount / dependency change so data
			// is never lost when navigating away or logging out.
			if (dbSaveTimer.current) {
				clearTimeout(dbSaveTimer.current);
				if (latestUserId.current) {
					saveReadsToDb(latestUserId.current, latestReadScanIds.current, latestReadUserIds.current);
				}
			}
		};
	}, [readScanIds, readUserIds, readStateLoaded, user?.id]);

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
		// Also exclude 'Non-Ampalaya' scans — they do not require expert validation
		const pending = scans.filter((scan) => {
			// Exclude 'Unknown' status scans
			if (scan.status === 'Unknown') return false;
			// Only include pending validation scans
			if (scan.status !== "Pending Validation") return false;
			// Exclude scans with result = 'Unknown' (disease_detected or ripeness_stage)
			const result = getAiPrediction(scan);
			if (result === 'Unknown') return false;
			// Exclude Non-Ampalaya scans — these do not need expert validation
			if (result.toLowerCase().includes('non-ampalaya') || result.toLowerCase().includes('non ampalaya')) return false;
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

	// Drop read markers for scans that are no longer pending.
	// GUARD: skip while scan data or persisted read-state is still loading —
	// otherwise the empty pendingScans during initial fetch wipes all read IDs.
	useEffect(() => {
		if (loading || !readStateLoaded) return;

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

			return changed ? next : prev;
		});
	}, [pendingScans, loading, readStateLoaded]);

	// Drop read markers for users that are no longer pending.
	// Same loading guard as above to prevent wiping on refresh.
	useEffect(() => {
		if (usersLoading || userLoading || !readStateLoaded) return;

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

			return changed ? next : prev;
		});
	}, [pendingUsers, usersLoading, userLoading, readStateLoaded]);

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

			return changed ? next : prev;
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

			return changed ? next : prev;
		});
	}, []);

	/**
	 * Mark ALL pending scans + pending users as read in a single batch.
	 * Optimised: builds both Sets in one pass and persists once.
	 */
	const markAllAsRead = useCallback(() => {
		// Batch-mark all scans
		if (pendingScans.length > 0) {
			setReadScanIds((prev) => {
				const next = new Set(prev);
				let changed = false;
				for (const scan of pendingScans) {
					if (!next.has(scan.id)) { next.add(scan.id); changed = true; }
				}
				return changed ? next : prev;
			});
		}
		// Batch-mark all users
		if (pendingUsers.length > 0) {
			setReadUserIds((prev) => {
				const next = new Set(prev);
				let changed = false;
				for (const u of pendingUsers) {
					if (!next.has(u.id)) { next.add(u.id); changed = true; }
				}
				return changed ? next : prev;
			});
		}
	}, [pendingScans, pendingUsers]);

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
			// - Admin: sees ONLY new user registrations pending approval (status='pending')
			// - Expert: sees ONLY new scans needing validation (status='Pending Validation')
			// - Any other role (farmer, unknown, not logged in): sees nothing
			pendingScans: isExpert ? pendingScans : [],
			pendingUsers: isAdmin ? pendingUsers : [],
			unreadCount: isAdmin ? unreadUsersCount : isExpert ? unreadScansCount : 0,
			unreadScansCount: isExpert ? unreadScansCount : 0,
			unreadUsersCount: isAdmin ? unreadUsersCount : 0,
			loading: loading || usersLoading || userLoading,
			error,
			refreshNotifications,
			markScansAsRead,
			markUsersAsRead,
			markAllAsRead,
			isScanRead,
			isUserRead,
		}),
		[pendingScans, pendingUsers, unreadScansCount, unreadUsersCount, loading, usersLoading, userLoading, isAdmin, isExpert, error, refreshNotifications, markScansAsRead, markUsersAsRead, markAllAsRead, isScanRead, isUserRead]
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

