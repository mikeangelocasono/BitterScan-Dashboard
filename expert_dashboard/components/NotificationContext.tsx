"use client";

import { ReactNode, createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
import { Scan } from "../types";
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
		console.warn("Error loading read scan IDs from localStorage:", error);
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
		console.warn("Error saving read scan IDs to localStorage:", error);
	}
}

export function NotificationProvider({ children }: { children: ReactNode }) {
	const { scans, loading, error, refreshData } = useData();
	const [readScanIds, setReadScanIds] = useState<Set<number>>(() => loadReadScanIds());

	// Filter scans to get only pending validation scans (these are our "notifications")
	// Status must match exactly: "Pending Validation" (capital P and V)
	// This automatically updates in real-time when DataContext receives new scans via Supabase Realtime
	const pendingScans = useMemo(() => {
		if (!scans || scans.length === 0) return [];
		// Filter for scans with status = 'Pending Validation' (exact match required)
		const pending = scans.filter((scan) => scan.status === "Pending Validation");
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

	// Unread count is simply the number of pending scans that haven't been marked as read yet
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

