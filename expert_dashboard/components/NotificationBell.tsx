"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Bell, ExternalLink, UserCircle, CheckCheck } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNotifications, type NotificationFilter } from "./NotificationContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";

export default function NotificationBell() {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const {
		pendingScans,
		pendingUsers,
		unreadCount,
		unreadScansCount,
		unreadUsersCount,
		loading,
		markScansAsRead,
		markUsersAsRead,
		markAllAsRead,
		isScanRead,
		isUserRead,
	} = useNotifications();
	const router = useRouter();
	const prevUnreadCountRef = useRef<number | null>(null);
	const isInitialMountRef = useRef(true);
	const [hasNewNotification, setHasNewNotification] = useState(false);

	/** Active filter tab — persists while dropdown is open, resets on close */
	const [filter, setFilter] = useState<NotificationFilter>("all");

	// Reset filter to "all" every time the dropdown is re-opened
	useEffect(() => {
		if (isOpen) setFilter("all");
	}, [isOpen]);

	// ─── Merged + sorted notification list ─────────────────────────────────
	const allNotifications = useMemo(() => {
		const scanNotifications = pendingScans.map((scan) => ({
			type: "scan" as const,
			id: scan.id.toString(),
			data: scan,
			created_at: scan.created_at,
			isRead: isScanRead(scan.id),
		}));

		const userNotifications = pendingUsers.map((user) => ({
			type: "user" as const,
			id: user.id,
			data: user,
			created_at: user.created_at,
			isRead: isUserRead(user.id),
		}));

		return [...scanNotifications, ...userNotifications]
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
			.slice(0, 20); // Raised limit to 20 — filter may reduce visible count
	}, [pendingScans, pendingUsers, isScanRead, isUserRead]);

	// ─── Filtered list based on active tab ──────────────────────────────────
	const filteredNotifications = useMemo(() => {
		if (filter === "all") return allNotifications;
		if (filter === "unread") return allNotifications.filter((n) => !n.isRead);
		return allNotifications.filter((n) => n.isRead); // "read"
	}, [allNotifications, filter]);

	// ─── New-notification detection (toast + bell animation) ────────────────
	useEffect(() => {
		if (!loading && isInitialMountRef.current) {
			prevUnreadCountRef.current = unreadCount;
			isInitialMountRef.current = false;
		}
	}, [loading, unreadCount]);

	useEffect(() => {
		if (loading || isInitialMountRef.current) return;

		if (prevUnreadCountRef.current !== null && unreadCount > prevUnreadCountRef.current && !isOpen) {
			const newCount = unreadCount - prevUnreadCountRef.current;
			setHasNewNotification(true);

			if (newCount === 1) {
				const newest = allNotifications[0];
				if (newest) {
					if (newest.type === "scan") {
						const scan = newest.data;
						const farmerName = scan.farmer_profile?.full_name || scan.farmer_profile?.username || "A farmer";
						const scanType = scan.scan_type === "leaf_disease" ? "Leaf Disease" : "Fruit Maturity";
						toast.success(
							() => (
								<div className="flex flex-col gap-1">
									<span className="text-sm font-semibold text-gray-900">
										New scan from <span className="text-[#388E3C]">{farmerName}</span>
									</span>
									<span className="text-xs text-gray-600 font-medium">{scanType} scan needs validation</span>
								</div>
							),
							{
								duration: 4000,
								position: "top-right",
								icon: "🔔",
								style: {
									background: "white",
									border: "1px solid #E5E7EB",
									borderLeft: "4px solid #388E3C",
									boxShadow: "0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -1px rgba(0,0,0,.06)",
									color: "#1F2937",
								},
							}
						);
					} else if (newest.type === "user") {
						const user = newest.data;
						const userName = user.full_name || user.username || user.email;
						const userRole = user.role === "expert" ? "Expert" : "Farmer";
						toast.success(
							() => (
								<div className="flex flex-col gap-1">
									<span className="text-sm font-semibold text-gray-900">
										New <span className="text-[#388E3C]">{userRole}</span> registration
									</span>
									<span className="text-xs text-gray-600 font-medium">{userName} pending approval</span>
								</div>
							),
							{
								duration: 4000,
								position: "top-right",
								icon: "👤",
								style: {
									background: "white",
									border: "1px solid #E5E7EB",
									borderLeft: "4px solid #3B82F6",
									boxShadow: "0 4px 6px -1px rgba(0,0,0,.1),0 2px 4px -1px rgba(0,0,0,.06)",
									color: "#1F2937",
								},
							}
						);
					}
				}
			}

			// Update ref NOW so subsequent renders don't re-fire for the same delta
			prevUnreadCountRef.current = unreadCount;

			const timer = setTimeout(() => setHasNewNotification(false), 2000);
			return () => clearTimeout(timer);
		}

		if (!loading && !isInitialMountRef.current) {
			prevUnreadCountRef.current = unreadCount;
		}
	}, [unreadCount, isOpen, allNotifications, loading]);

	// ─── Outside-click handler ──────────────────────────────────────────────
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		};
		if (isOpen) document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isOpen]);

	// ─── Click handler: mark as read + navigate ─────────────────────────────
	// Debounce guard prevents double-fire on rapid clicks
	const clickGuard = useRef(false);

	const handleNotificationClick = useCallback(
		(notificationType: "scan" | "user", id: string) => {
			if (clickGuard.current) return; // Prevent rapid double-click
			clickGuard.current = true;
			setTimeout(() => { clickGuard.current = false; }, 400);

			// Mark this specific item as read (instant — updates badge + visual state)
			if (notificationType === "scan") {
				markScansAsRead([parseInt(id)]);
				router.push("/validate");
			} else {
				markUsersAsRead([id]);
				router.push("/admin-dashboard/approvals");
			}
			setIsOpen(false);
		},
		[router, markScansAsRead, markUsersAsRead]
	);

	// ─── "Mark all as read" handler ─────────────────────────────────────────
	const handleMarkAllRead = useCallback(() => {
		markAllAsRead();
	}, [markAllAsRead]);

	// ─── Time formatters (unchanged logic) ──────────────────────────────────
	const formatExactTimestamp = useCallback((dateString: string) => {
		try {
			const date = new Date(dateString);
			if (isNaN(date.getTime())) return "Invalid date";
			let hours = date.getHours();
			const minutes = date.getMinutes();
			const ampm = hours >= 12 ? "PM" : "AM";
			hours = hours % 12 || 12;
			return `${hours}:${minutes < 10 ? "0" : ""}${minutes} ${ampm}`;
		} catch {
			return dateString;
		}
	}, []);

	const formatRelativeTime = useCallback((dateString: string) => {
		try {
			const date = new Date(dateString);
			if (isNaN(date.getTime())) return "";
			const diffMs = Date.now() - date.getTime();
			const diffMins = Math.floor(diffMs / 60000);
			const diffHours = Math.floor(diffMs / 3600000);
			const diffDays = Math.floor(diffMs / 86400000);
			if (diffMins < 1) return "Just now";
			if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? "s" : ""} ago`;
			if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
			if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
			return "";
		} catch {
			return "";
		}
	}, []);

	// ─── Filter tab config ──────────────────────────────────────────────────
	const filterTabs: { key: NotificationFilter; label: string }[] = [
		{ key: "all", label: "All" },
		{ key: "unread", label: "Unread" },
		{ key: "read", label: "Read" },
	];

	// ─── Render ─────────────────────────────────────────────────────────────
	return (
		<div className="relative" ref={dropdownRef}>
			{/* Bell button + badge */}
			<button
				onClick={() => {
					setIsOpen(!isOpen);
					setHasNewNotification(false);
				}}
				className={`relative flex items-center justify-center w-10 h-10 rounded-lg hover:bg-gray-100 transition-all focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:ring-offset-2 ${
					hasNewNotification ? "animate-pulse" : ""
				}`}
				aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
			>
				<Bell className={`h-5 w-5 text-gray-600 transition-colors ${hasNewNotification ? "text-[#388E3C]" : ""}`} />
				{/* Badge — only counts unread */}
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

			{/* Dropdown panel */}
			<AnimatePresence>
				{isOpen && (
					<motion.div
						initial={{ opacity: 0, y: -10, scale: 0.95 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -10, scale: 0.95 }}
						transition={{ duration: 0.2 }}
						className="absolute right-0 mt-2 w-96 bg-[var(--surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 overflow-hidden"
					>
						{/* ── Header ──────────────────────────────────────────────── */}
						<div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
							<h3 className="text-sm font-semibold text-[var(--foreground)]">
								Notifications {unreadCount > 0 && `(${unreadCount})`}
							</h3>
							<div className="flex items-center gap-2">
								{/* Summary chips */}
								{(unreadScansCount > 0 || unreadUsersCount > 0) && (
									<div className="flex items-center gap-2 text-xs text-gray-500">
										{unreadScansCount > 0 && <span>{unreadScansCount} scan{unreadScansCount > 1 ? "s" : ""}</span>}
										{unreadScansCount > 0 && unreadUsersCount > 0 && <span>&bull;</span>}
										{unreadUsersCount > 0 && <span>{unreadUsersCount} user{unreadUsersCount > 1 ? "s" : ""}</span>}
									</div>
								)}
								{/* Mark all as read button — only visible when there are unread items */}
								{unreadCount > 0 && (
									<button
										onClick={handleMarkAllRead}
										className="flex items-center gap-1 text-xs text-[var(--primary)] hover:text-[var(--primary)]/80 font-medium transition-colors px-2 py-1 rounded hover:bg-gray-100 focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
										aria-label="Mark all notifications as read"
									>
										<CheckCheck className="h-3.5 w-3.5" />
										<span className="hidden sm:inline">Mark all read</span>
									</button>
								)}
							</div>
						</div>

						{/* ── Filter Tabs ─────────────────────────────────────────── */}
						<div className="flex border-b border-[var(--color-border)]" role="tablist" aria-label="Filter notifications">
							{filterTabs.map((tab) => {
								const isActive = filter === tab.key;
								return (
									<button
										key={tab.key}
										role="tab"
										aria-selected={isActive}
										onClick={() => setFilter(tab.key)}
										className={`flex-1 text-xs font-medium py-2 transition-colors focus:outline-none focus:ring-1 focus:ring-inset focus:ring-[var(--primary)] ${
											isActive
												? "text-[var(--primary)] border-b-2 border-[var(--primary)] bg-[var(--primary-50,transparent)]"
												: "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
										}`}
									>
										{tab.label}
										{/* Show count on "Unread" tab for quick glance */}
										{tab.key === "unread" && unreadCount > 0 && (
											<span className="ml-1 inline-flex items-center justify-center min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full">
												{unreadCount > 99 ? "99+" : unreadCount}
											</span>
										)}
									</button>
								);
							})}
						</div>

						{/* ── Notification List ──────────────────────────────────── */}
						<div className="max-h-96 overflow-y-auto">
							{loading ? (
								<div className="flex items-center justify-center py-8">
									<div className="h-6 w-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
								</div>
							) : filteredNotifications.length === 0 ? (
								/* Empty state — contextual message based on active filter */
								<div className="flex flex-col items-center justify-center py-8 px-4 text-center">
									<Bell className="h-12 w-12 text-gray-300 mb-2" />
									<p className="text-sm text-gray-500">
										{filter === "all"
											? "No pending notifications"
											: filter === "unread"
											? "No unread notifications"
											: "No read notifications yet"}
									</p>
									<p className="text-xs text-gray-400 mt-1">
										{filter === "all"
											? "All items have been processed"
											: filter === "unread"
											? "You\u2019re all caught up!"
											: "Click a notification to mark it as read"}
									</p>
								</div>
							) : (
								<div className="divide-y divide-gray-100">
									{filteredNotifications.map((notification) => {
										const isUnread = !notification.isRead;

										if (notification.type === "scan") {
											const scan = notification.data;
											const farmerName = scan.farmer_profile?.full_name || scan.farmer_profile?.username || "Unknown Farmer";
											const scanTypeLabel = scan.scan_type === "leaf_disease" ? "Leaf Disease" : scan.scan_type === "fruit_maturity" ? "Fruit Maturity" : "Unknown Type";
											const uniqueKey = scan.scan_uuid || `${scan.scan_type}-${scan.id}`;

											return (
												<button
													key={uniqueKey}
													onClick={() => handleNotificationClick("scan", scan.id.toString())}
													className={`w-full text-left p-4 transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--primary)] ${
														isUnread
															? "bg-[#F0FDF4] hover:bg-[#DCFCE7] border-l-4 border-[var(--primary)]"
															: "bg-white hover:bg-gray-50 border-l-4 border-transparent"
													}`}
													aria-label={`${isUnread ? "Unread: " : ""}New scan from ${farmerName} — ${scanTypeLabel}`}
												>
													<div className="flex items-start gap-3">
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2 mb-1.5">
																<p className={`text-sm font-semibold ${isUnread ? "text-gray-900" : "text-gray-600"} transition-colors duration-300`}>
																	New scan from <span className="text-[var(--primary)]">{farmerName}</span>
																</p>
																{/* Unread dot — fades out when read */}
																<span
																	className={`flex-shrink-0 w-2 h-2 rounded-full transition-all duration-300 ${
																		isUnread ? "bg-[var(--primary)] scale-100 opacity-100" : "bg-transparent scale-0 opacity-0"
																	}`}
																/>
															</div>
															<p className={`text-xs font-medium mb-2 transition-colors duration-300 ${isUnread ? "text-gray-600" : "text-gray-400"}`}>
																{scanTypeLabel} scan needs validation
															</p>
															<p className="text-xs text-gray-500 font-normal" title={formatRelativeTime(scan.created_at) || undefined}>
																{formatExactTimestamp(scan.created_at)}
																{formatRelativeTime(scan.created_at) && (
																	<span className="ml-1.5 text-gray-400">({formatRelativeTime(scan.created_at)})</span>
																)}
															</p>
														</div>
														<ExternalLink className="h-4 w-4 text-[var(--primary)] flex-shrink-0 mt-0.5 opacity-60 hover:opacity-100 transition-opacity" />
													</div>
												</button>
											);
										} else {
											// ─── User notification (admin only) ──────────────
											const user = notification.data;
											const userName = user.full_name || user.username || user.email;
											const userRole = user.role === "expert" ? "Expert" : user.role === "farmer" ? "Farmer" : "User";
											const roleColor = user.role === "expert" ? "text-blue-600" : "text-amber-600";

											return (
												<button
													key={user.id}
													onClick={() => handleNotificationClick("user", user.id)}
													className={`w-full text-left p-4 transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 ${
														isUnread
															? "bg-blue-50 hover:bg-blue-100 border-l-4 border-blue-500"
															: "bg-white hover:bg-gray-50 border-l-4 border-transparent"
													}`}
													aria-label={`${isUnread ? "Unread: " : ""}New ${userRole} registration — ${userName}`}
												>
													<div className="flex items-start gap-3">
														<div className="flex-shrink-0 mt-0.5">
															<UserCircle className={`h-5 w-5 transition-colors duration-300 ${isUnread ? roleColor : "text-gray-400"}`} />
														</div>
														<div className="flex-1 min-w-0">
															<div className="flex items-center gap-2 mb-1.5">
																<p className={`text-sm font-semibold ${isUnread ? "text-gray-900" : "text-gray-600"} transition-colors duration-300`}>
																	New <span className={roleColor}>{userRole}</span> registration
																</p>
																<span
																	className={`flex-shrink-0 w-2 h-2 rounded-full transition-all duration-300 ${
																		isUnread ? "bg-blue-500 scale-100 opacity-100" : "bg-transparent scale-0 opacity-0"
																	}`}
																/>
															</div>
															<p className={`text-xs font-medium mb-2 transition-colors duration-300 ${isUnread ? "text-gray-600" : "text-gray-400"}`}>
																{userName} pending approval
															</p>
															<p className="text-xs text-gray-500 font-normal" title={formatRelativeTime(user.created_at) || undefined}>
																{formatExactTimestamp(user.created_at)}
																{formatRelativeTime(user.created_at) && (
																	<span className="ml-1.5 text-gray-400">({formatRelativeTime(user.created_at)})</span>
																)}
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

						{/* ── Footer ─────────────────────────────────────────────── */}
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

