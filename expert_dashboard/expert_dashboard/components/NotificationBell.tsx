"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Bell, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNotifications } from "./NotificationContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

export default function NotificationBell() {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const { pendingScans, unreadCount, loading, markScansAsRead, isScanRead } = useNotifications();
	const router = useRouter();
	const prevUnreadCountRef = useRef<number | null>(null); // Start as null to track initial mount
	const isInitialMountRef = useRef(true); // Track if this is the initial mount
	const [hasNewNotification, setHasNewNotification] = useState(false);

	// Sort pending scans by creation date (newest first) and limit to 10
	const recentPendingScans = useMemo(() => {
		return [...pendingScans]
			.sort((a, b) => {
				const dateA = new Date(a.created_at).getTime();
				const dateB = new Date(b.created_at).getTime();
				return dateB - dateA;
			})
			.slice(0, 10);
	}, [pendingScans]);

	// Initialize prevUnreadCountRef after loading completes (prevents false positives on page refresh)
	useEffect(() => {
		if (!loading && isInitialMountRef.current) {
			// After initial load completes, set the baseline count
			prevUnreadCountRef.current = unreadCount;
			isInitialMountRef.current = false;
		}
	}, [loading, unreadCount]);

	// Detect when new notifications arrive (Facebook-like behavior)
	// Only trigger after initial mount is complete to prevent false positives on page refresh
	useEffect(() => {
		// Skip if still loading or if this is the initial mount
		if (loading || isInitialMountRef.current) {
			return;
		}

		// Only show toast if count actually increased (not on initial load)
		if (prevUnreadCountRef.current !== null && unreadCount > prevUnreadCountRef.current && !isOpen) {
			const newCount = unreadCount - prevUnreadCountRef.current;
			setHasNewNotification(true);
			
			// Show toast notification for new scans (like Facebook) - only for single new scan
			if (newCount === 1) {
				// Get the newest pending scan
				const newestScan = recentPendingScans[0];
				if (newestScan) {
					const farmerName = newestScan.farmer_profile?.full_name || newestScan.farmer_profile?.username || "A farmer";
					const scanType = newestScan.scan_type === "leaf_disease" ? "Leaf Disease" : "Fruit Maturity";
					toast.success(
						() => (
							<div className="flex flex-col">
								<span className="font-semibold">New scan from {farmerName}</span>
								<span className="text-xs text-gray-600">{scanType} scan needs validation</span>
							</div>
						),
						{
							duration: 4000,
							position: "top-right",
							icon: "🔔",
						}
					);
				}
			}
			// Removed the "2 new scans need validation" message as requested
			
			// Reset animation after 2 seconds
			const timer = setTimeout(() => setHasNewNotification(false), 2000);
			return () => clearTimeout(timer);
		}
		
		// Update the previous count after processing
		if (!loading && !isInitialMountRef.current) {
			prevUnreadCountRef.current = unreadCount;
		}
	}, [unreadCount, isOpen, recentPendingScans, loading]);

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};

		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside);
		}

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [isOpen]);

	const handleNotificationClick = useCallback(
		(scanId: number) => {
			// Mark this specific scan as read
			markScansAsRead([scanId]);
			setIsOpen(false);
			// Navigate to validate page
			router.push("/validate");
		},
		[router, markScansAsRead]
	);

	/**
	 * Format time as "HH:MM AM/PM" matching the actual scan timestamp from database
	 * This displays the exact time the scan was created (hours:minutes + AM/PM format)
	 */
	const formatExactTimestamp = useCallback((dateString: string) => {
		try {
			const date = new Date(dateString);
			// Check if date is valid
			if (isNaN(date.getTime())) {
				return "Invalid date";
			}

			// Format as "HH:MM AM/PM" using the exact timestamp from database
			// Use UTC to match database timestamp exactly
			let hours = date.getUTCHours();
			const minutes = date.getUTCMinutes();
			const ampm = hours >= 12 ? 'PM' : 'AM';
			hours = hours % 12;
			hours = hours ? hours : 12; // 0 should be 12
			const minutesStr = minutes < 10 ? `0${minutes}` : minutes;
			
			return `${hours}:${minutesStr} ${ampm}`;
		} catch {
			return dateString;
		}
	}, []);

	// Format relative time for tooltip/secondary display
	const formatRelativeTime = useCallback((dateString: string) => {
		try {
			const date = new Date(dateString);
			if (isNaN(date.getTime())) {
				return "";
			}
			
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffMins = Math.floor(diffMs / 60000);
			const diffHours = Math.floor(diffMs / 3600000);
			const diffDays = Math.floor(diffMs / 86400000);

			if (diffMins < 1) {
				return "Just now";
			} else if (diffMins < 60) {
				return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
			} else if (diffHours < 24) {
				return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
			} else if (diffDays < 7) {
				return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
			}
			return "";
		} catch {
			return "";
		}
	}, []);

	return (
		<div className="relative" ref={dropdownRef}>
			<button
				onClick={() => {
					setIsOpen(!isOpen);
					setHasNewNotification(false);
				}}
				className={`relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
					hasNewNotification ? "animate-pulse" : ""
				}`}
				aria-label="Notifications"
			>
				<Bell className={`h-5 w-5 text-gray-600 transition-colors ${hasNewNotification ? "text-emerald-600" : ""}`} />
				{unreadCount > 0 && (
					<motion.span
						key={unreadCount}
						initial={{ scale: 0 }}
						animate={{ scale: 1 }}
						className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-xs font-semibold rounded-full shadow-lg"
					>
						{unreadCount > 99 ? "99+" : unreadCount}
					</motion.span>
				)}
			</button>

			<AnimatePresence>
				{isOpen && (
					<motion.div
						initial={{ opacity: 0, y: -10, scale: 0.95 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -10, scale: 0.95 }}
						transition={{ duration: 0.2 }}
						className="absolute right-0 mt-2 w-96 bg-[var(--surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 overflow-hidden"
					>
						{/* Header */}
						<div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
							<h3 className="text-sm font-semibold text-[var(--foreground)]">
								Pending Scans {unreadCount > 0 && `(${unreadCount})`}
							</h3>
						</div>

						{/* Notifications List */}
						<div className="max-h-96 overflow-y-auto">
							{loading ? (
								<div className="flex items-center justify-center py-8">
									<div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
								</div>
							) : recentPendingScans.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
									<Bell className="h-12 w-12 text-gray-300 mb-2" />
									<p className="text-sm text-gray-500">No pending scans</p>
									<p className="text-xs text-gray-400 mt-1">All scans have been validated</p>
								</div>
							) : (
								<div className="divide-y divide-gray-200">
									{recentPendingScans.map((scan) => {
										const farmerName =
											scan.farmer_profile?.full_name ||
											scan.farmer_profile?.username ||
											"Unknown Farmer";
										const scanTypeLabel =
											scan.scan_type === "leaf_disease"
												? "Leaf Disease"
											: scan.scan_type === "fruit_maturity"
												? "Fruit Maturity"
											: "Unknown Type";
										
										// Check if this scan is unread
										const isUnread = !isScanRead(scan.id);

										return (
											<button
												key={scan.id}
												onClick={() => handleNotificationClick(scan.id)}
												className={`w-full text-left p-4 transition-colors ${
													isUnread 
														? "bg-blue-50 hover:bg-blue-100 border-l-4 border-blue-500" 
														: "bg-white hover:bg-gray-50"
												}`}
											>
												<div className="flex items-start gap-3">
													<div className="flex-1 min-w-0">
														<div className="flex items-center gap-2">
															<p className="text-sm font-semibold text-gray-900 truncate">{farmerName}</p>
															{isUnread && (
																<span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full" />
															)}
														</div>
														<p className="text-xs text-gray-600 mt-1">{scanTypeLabel}</p>
														{/* Display exact timestamp from database */}
														<p className="text-xs text-gray-500 mt-1.5 font-medium" title={formatRelativeTime(scan.created_at) || undefined}>
															{formatExactTimestamp(scan.created_at)}
														</p>
													</div>
													<ExternalLink className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
												</div>
											</button>
										);
									})}
								</div>
							)}
						</div>

						{/* Footer */}
						{recentPendingScans.length > 0 && (
							<div className="p-3 border-t border-[var(--color-border)] bg-gray-50">
								<Link
									href="/validate"
									onClick={() => setIsOpen(false)}
									className="block text-center text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 font-medium transition-colors"
								>
									View all pending scans ({unreadCount})
								</Link>
							</div>
						)}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

