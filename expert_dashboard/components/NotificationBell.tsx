"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Bell, ExternalLink, UserCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNotifications } from "./NotificationContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

export default function NotificationBell() {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const { pendingScans, pendingUsers, unreadCount, unreadScansCount, unreadUsersCount, loading, markScansAsRead, markUsersAsRead, isScanRead, isUserRead } = useNotifications();
	const router = useRouter();
	const prevUnreadCountRef = useRef<number | null>(null); // Start as null to track initial mount
	const isInitialMountRef = useRef(true); // Track if this is the initial mount
	const [hasNewNotification, setHasNewNotification] = useState(false);

	// Merge and sort notifications (scans + pending users) by creation date (newest first)
	// Limit to 10 most recent
	const allNotifications = useMemo(() => {
		const scanNotifications = pendingScans.map(scan => ({
			type: 'scan' as const,
			id: scan.id.toString(),
			data: scan,
			created_at: scan.created_at,
			isRead: isScanRead(scan.id)
		}));
		
		const userNotifications = pendingUsers.map(user => ({
			type: 'user' as const,
			id: user.id,
			data: user,
			created_at: user.created_at,
			isRead: isUserRead(user.id)
		}));
		
		return [...scanNotifications, ...userNotifications]
			.sort((a, b) => {
				const dateA = new Date(a.created_at).getTime();
				const dateB = new Date(b.created_at).getTime();
				return dateB - dateA;
			})
			.slice(0, 10);
	}, [pendingScans, pendingUsers, isScanRead, isUserRead]);

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
			
			// Show toast notification for new items (like Facebook) - only for single new item
			if (newCount === 1) {
				// Get the newest notification (could be scan or user)
				const newestNotification = allNotifications[0];
				if (newestNotification) {
					if (newestNotification.type === 'scan') {
						const scan = newestNotification.data;
						const farmerName = scan.farmer_profile?.full_name || scan.farmer_profile?.username || "A farmer";
						const scanType = scan.scan_type === "leaf_disease" ? "Leaf Disease" : "Fruit Maturity";
						toast.success(
							() => (
								<div className="flex flex-col gap-1">
									<span className="text-sm font-semibold text-gray-900">
										New scan from <span className="text-[#388E3C]">{farmerName}</span>
									</span>
									<span className="text-xs text-gray-600 font-medium">
										{scanType} scan needs validation
									</span>
								</div>
							),
							{
								duration: 4000,
								position: "top-right",
								icon: "🔔",
								style: {
									background: 'white',
									border: '1px solid #E5E7EB',
									borderLeft: '4px solid #388E3C',
									boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
									color: '#1F2937',
								},
							}
						);
					} else if (newestNotification.type === 'user') {
						const user = newestNotification.data;
						const userName = user.full_name || user.username || user.email;
						const userRole = user.role === 'expert' ? 'Expert' : 'Farmer';
						toast.success(
							() => (
								<div className="flex flex-col gap-1">
									<span className="text-sm font-semibold text-gray-900">
										New <span className="text-[#388E3C]">{userRole}</span> registration
									</span>
									<span className="text-xs text-gray-600 font-medium">
										{userName} pending approval
									</span>
								</div>
							),
							{
								duration: 4000,
								position: "top-right",
								icon: "👤",
								style: {
									background: 'white',
									border: '1px solid #E5E7EB',
									borderLeft: '4px solid #3B82F6',
									boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
									color: '#1F2937',
								},
							}
						);
					}
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
	}, [unreadCount, isOpen, allNotifications, loading]);

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
		(notificationType: 'scan' | 'user', id: string) => {
			// Mark this specific item as read
			if (notificationType === 'scan') {
				markScansAsRead([parseInt(id)]);
				// Navigate to validate page
				router.push("/validate");
			} else {
				markUsersAsRead([id]);
				// Navigate to approvals page
				router.push("/admin-dashboard/approvals");
			}
			setIsOpen(false);
		},
		[router, markScansAsRead, markUsersAsRead]
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
			// Get UTC hours (0-23)
			let hours = date.getUTCHours();
			const minutes = date.getUTCMinutes();
			
			// Determine AM/PM BEFORE converting to 12-hour format
			// This is critical: check the original 24-hour value (0-23)
			const ampm = hours >= 12 ? 'PM' : 'AM';
			
			// Convert to 12-hour format (1-12)
			hours = hours % 12;
			hours = hours || 12; // Convert 0 to 12 (midnight/noon)
			
			const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
			
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
				className={`relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 transition-all focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:ring-offset-2 ${
					hasNewNotification ? "animate-pulse" : ""
				}`}
				aria-label="Notifications"
			>
				<Bell className={`h-5 w-5 text-gray-600 transition-colors ${hasNewNotification ? "text-[#388E3C]" : ""}`} />
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
								Notifications {unreadCount > 0 && `(${unreadCount})`}
							</h3>
							{(unreadScansCount > 0 || unreadUsersCount > 0) && (
								<div className="flex items-center gap-2 text-xs text-gray-500">
									{unreadScansCount > 0 && <span>{unreadScansCount} scan{unreadScansCount > 1 ? 's' : ''}</span>}
									{unreadScansCount > 0 && unreadUsersCount > 0 && <span>•</span>}
									{unreadUsersCount > 0 && <span>{unreadUsersCount} user{unreadUsersCount > 1 ? 's' : ''}</span>}
								</div>
							)}
						</div>

						{/* Notifications List */}
						<div className="max-h-96 overflow-y-auto">
							{loading ? (
								<div className="flex items-center justify-center py-8">
									<div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
								</div>
							) : allNotifications.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
									<Bell className="h-12 w-12 text-gray-300 mb-2" />
									<p className="text-sm text-gray-500">No pending notifications</p>
									<p className="text-xs text-gray-400 mt-1">All items have been processed</p>
								</div>
							) : (
								<div className="divide-y divide-gray-200">
									{allNotifications.map((notification) => {
										const isUnread = !notification.isRead;

										if (notification.type === 'scan') {
											const scan = notification.data;
											const farmerName = scan.farmer_profile?.full_name || scan.farmer_profile?.username || "Unknown Farmer";
											const scanTypeLabel = scan.scan_type === "leaf_disease" ? "Leaf Disease" : scan.scan_type === "fruit_maturity" ? "Fruit Maturity" : "Unknown Type";
											const uniqueKey = scan.scan_uuid || `${scan.scan_type}-${scan.id}`;

											return (
												<button
													key={uniqueKey}
													onClick={() => handleNotificationClick('scan', scan.id.toString())}
													className={`w-full text-left p-4 transition-all duration-200 ${
														isUnread 
															? "bg-white hover:bg-[var(--primary-100)] border-l-4 border-[var(--primary)] shadow-sm" 
															: "bg-white hover:bg-gray-50 border-l-4 border-transparent"
													}`}
												>
													<div className="flex items-start gap-3">
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2 mb-1.5">
																<p className="text-sm font-semibold text-gray-900">
																	New scan from <span className="text-[var(--primary)]">{farmerName}</span>
																</p>
																{isUnread && (
																	<span className="flex-shrink-0 w-2 h-2 bg-[var(--primary)] rounded-full animate-pulse" />
																)}
															</div>
															<p className="text-xs text-gray-600 font-medium mb-2">
																{scanTypeLabel} scan needs validation
															</p>
															<p className="text-xs text-gray-500 font-normal" title={formatRelativeTime(scan.created_at) || undefined}>
																{formatExactTimestamp(scan.created_at)}
															</p>
														</div>
														<ExternalLink className="h-4 w-4 text-[var(--primary)] flex-shrink-0 mt-0.5 opacity-60 hover:opacity-100 transition-opacity" />
													</div>
												</button>
											);
										} else {
											// User notification
											const user = notification.data;
											const userName = user.full_name || user.username || user.email;
											const userRole = user.role === 'expert' ? 'Expert' : user.role === 'farmer' ? 'Farmer' : 'User';
											const roleColor = user.role === 'expert' ? 'text-blue-600' : 'text-amber-600';

											return (
												<button
													key={user.id}
													onClick={() => handleNotificationClick('user', user.id)}
													className={`w-full text-left p-4 transition-all duration-200 ${
														isUnread 
															? "bg-white hover:bg-blue-50 border-l-4 border-blue-500 shadow-sm" 
															: "bg-white hover:bg-gray-50 border-l-4 border-transparent"
													}`}
												>
													<div className="flex items-start gap-3">
														<div className="flex-shrink-0 mt-0.5">
															<UserCircle className={`h-5 w-5 ${isUnread ? roleColor : 'text-gray-400'}`} />
														</div>
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2 mb-1.5">
																<p className="text-sm font-semibold text-gray-900">
																	New <span className={roleColor}>{userRole}</span> registration
																</p>
																{isUnread && (
																	<span className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
																)}
															</div>
															<p className="text-xs text-gray-600 font-medium mb-2">
																{userName} pending approval
															</p>
															<p className="text-xs text-gray-500 font-normal" title={formatRelativeTime(user.created_at) || undefined}>
																{formatExactTimestamp(user.created_at)}
															</p>
														</div>
														<ExternalLink className="h-4 w-4 text-blue-500 flex-shrink-0 mt-0.5 opacity-60 hover:opacity-100 transition-opacity" />
													</div>
												</button>
											);
										}
									})}
								</div>
							)}
						</div>

						{/* Footer */}
						{allNotifications.length > 0 && (
							<div className="p-3 border-t border-[var(--color-border)] bg-gray-50">
								<div className="flex items-center justify-between gap-2">
									{pendingScans.length > 0 && (
										<Link
											href="/validate"
											onClick={() => setIsOpen(false)}
											className="flex-1 text-center text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 font-medium transition-colors py-1 px-2 rounded hover:bg-gray-100"
										>
											View scans ({unreadScansCount})
										</Link>
									)}
									{pendingUsers.length > 0 && (
										<Link
											href="/admin-dashboard/approvals"
											onClick={() => setIsOpen(false)}
											className="flex-1 text-center text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors py-1 px-2 rounded hover:bg-gray-100"
										>
											View users ({unreadUsersCount})
										</Link>
									)}
								</div>
							</div>
						)}
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}

