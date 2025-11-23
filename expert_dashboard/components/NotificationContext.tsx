"use client";

import { ReactNode, createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import { Scan, getAiPrediction } from "../types";
import { useData } from "./DataContext";

const READ_SCANS_STORAGE_KEY = "bs:read-scans";

type NotificationContextValue = {
	pendingScans: Scan[];
	unreadCount: number;
	loading: boolean;
	error: string | null;
	refreshNotifications: () => Promise<void>;
	markScansAsRead: (scanIds: number[]) => void;
	isScanRead: (scanId: number) => boolean;
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
	const [readScanIds, setReadScanIds] = useState<Set<number>>(() => loadReadScanIds());

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
			if (String(scan.status) === 'Unknown') return false;
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

	/**
	 * REAL-TIME UNREAD COUNT: Calculate unread notifications
	 * 
	 * This memoized calculation ensures:
	 * - Count updates automatically when new scans arrive via real-time subscriptions
	 * - Count decreases when scans are validated/corrected (filtered out)
	 * - Count decreases when scans are marked as read
	 * - Efficient calculation only when pendingScans or readScanIds change
	 * 
	 * The count is displayed in the NotificationBell badge and updates instantly.
	 */
	const unreadCount = useMemo(() => {
		if (pendingScans.length === 0) return 0;
		return pendingScans.reduce((count, scan) => (readScanIds.has(scan.id) ? count : count + 1), 0);
	}, [pendingScans, readScanIds]);

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

	const value: NotificationContextValue = useMemo(
		() => ({
			pendingScans,
			unreadCount,
			loading,
			error,
			refreshNotifications,
			markScansAsRead,
			isScanRead,
		}),
		[pendingScans, unreadCount, loading, error, refreshNotifications, markScansAsRead, isScanRead]
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

