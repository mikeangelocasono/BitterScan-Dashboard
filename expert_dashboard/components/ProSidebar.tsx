"use client";

import React, { useMemo, useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardCheck, BarChart3, User, LogOut, FileText, Menu, ChevronLeft, UserCheck, PieChart, BookOpen } from "lucide-react";
import { clsx } from "clsx";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { useSidebar } from "./SidebarContext";
import { useUser } from "./UserContext";
import Image from "next/image";

// RBAC: Define navigation items with role requirements and section grouping
interface NavItem {
	href: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	roles: string[];
	section: string;
}

const navItems: NavItem[] = [
	// Expert navigation - Main
	{ href: "/expert-dashboard", label: "Overview", icon: LayoutDashboard, roles: ['expert'], section: "Main" },
	{ href: "/validate", label: "Pending Validation", icon: ClipboardCheck, roles: ['expert'], section: "Reviews" },
	{ href: "/history", label: "Validation History", icon: BarChart3, roles: ['expert'], section: "Reviews" },
	{ href: "/manage-disease-info", label: "Disease Library", icon: BookOpen, roles: ['expert'], section: "Management" },
	{ href: "/profile", label: "My Profile", icon: User, roles: ['expert'], section: "Account" },

	// Admin navigation - Main
	{ href: "/admin-dashboard", label: "Overview", icon: LayoutDashboard, roles: ['admin'], section: "Main" },
	{ href: "/admin-dashboard/approvals", label: "Account Approval", icon: UserCheck, roles: ['admin'], section: "User Management" },
	{ href: "/reports", label: "Reports", icon: FileText, roles: ['admin'], section: "Monitoring" },
	{ href: "/data-visualization", label: "Data Visualization", icon: PieChart, roles: ['admin'], section: "Monitoring" },
	{ href: "/history", label: "Validation History", icon: BarChart3, roles: ['admin'], section: "Monitoring" },
	{ href: "/profile", label: "My Profile", icon: User, roles: ['admin'], section: "Account" },
];

export function MobileSidebar({ onClose }: { onClose: () => void }) {
    return (
        <div className="h-full bg-[var(--surface)] text-[var(--foreground)] p-4">
            <SidebarLinks onClick={onClose} />
        </div>
    );
}

export default function ProSidebar() {
	const { isCollapsed, toggleCollapse, isHydrated } = useSidebar();

	return (
		<aside className={clsx(
			"h-screen bg-[var(--surface)] text-[var(--foreground)] border-r border-[var(--color-border)] shadow-sm",
			// Only enable width transitions after hydration to prevent flash
			isHydrated ? "transition-[width] duration-300" : "",
			isCollapsed ? "w-20" : "w-72"
		)}>
			<div>
				<div className="h-16 flex items-center justify-between px-4 border-b border-[var(--color-border)]">
					{/* Logo section - stable layout with no animations */}
					{!isCollapsed ? (
						<div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
							<Image src="/logo.png" alt="Logo" width={32} height={32} className="h-8 w-8 object-contain flex-shrink-0" />
							<span className="font-semibold whitespace-nowrap">BitterScan</span>
						</div>
					) : (
						<button
							onClick={toggleCollapse}
							className="p-1.5 rounded-md hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
							aria-label="Expand sidebar"
						>
							<Menu className="h-5 w-5 text-gray-600" />
						</button>
					)}
					{/* Collapse button - only visible when expanded */}
					{!isCollapsed && (
						<button
							onClick={toggleCollapse}
							className="p-1.5 rounded-md hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
							aria-label="Collapse sidebar"
						>
							<ChevronLeft className="h-5 w-5 text-gray-600" />
						</button>
					)}
				</div>
                <div className="p-3">
					<SidebarLinks isCollapsed={isCollapsed} />
				</div>
			</div>
		</aside>
	);
}

function SidebarLinks({ onClick, isCollapsed }: { onClick?: () => void; isCollapsed?: boolean }) {
	// Named function component for Fast Refresh support
	const pathname = usePathname();
	const [showLogoutDialog, setShowLogoutDialog] = useState(false);
	const { logout, profile, user } = useUser();

	const handleLogout = useCallback(async () => {
		setShowLogoutDialog(false);
		try {
			await logout(); // Handles animation delay internally; AuthGuard shows overlay & redirects
			onClick?.();
		} catch {
			toast.error("Error logging out. Please try again.");
		}
	}, [logout, onClick]);

	const confirmLogout = useCallback(() => {
		setShowLogoutDialog(true);
	}, []);

	// RBAC: Resolve role from multiple sources (profile > user_metadata > email hint)
	// This ensures navigation works even if profile hasn't loaded yet
	const resolvedRole = useMemo(() => {
		// Priority 1: Profile role from database
		if (profile?.role) {
			return profile.role.toLowerCase();
		}
		// Priority 2: User metadata role (set during registration/login)
		if (user?.user_metadata?.role) {
			return String(user.user_metadata.role).toLowerCase();
		}
		// Priority 3: Email-based hint for admin
		const emailLower = (user?.email || '').toLowerCase();
		if (emailLower.includes('admin')) {
			return 'admin';
		}
		return null;
	}, [profile?.role, user?.user_metadata?.role, user?.email]);

	// RBAC: Filter navigation items based on resolved role
	const filteredNavItems = useMemo(() => {
		if (!resolvedRole) return [];
		return navItems.filter(item => item.roles.includes(resolvedRole));
	}, [resolvedRole]);

	// Group items by section
	const groupedItems = useMemo(() => {
		const groups: { section: string; items: NavItem[] }[] = [];
		const seen = new Set<string>();
		for (const item of filteredNavItems) {
			if (!seen.has(item.section)) {
				seen.add(item.section);
				groups.push({ section: item.section, items: [] });
			}
			groups.find(g => g.section === item.section)?.items.push(item);
		}
		return groups;
	}, [filteredNavItems]);

	const navItemElements = useMemo(() => {
		return groupedItems.map((group, groupIdx) => (
			<div key={group.section} className={clsx(groupIdx > 0 && "mt-4 pt-3 border-t border-[var(--color-border)]")}>
				{!isCollapsed && group.section !== "Main" && (
					<p className="px-4 mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
						{group.section}
					</p>
				)}
				<div className="space-y-0.5">
					{group.items.map(({ href, label, icon: Icon }) => {
						const active = pathname === href;
						return (
							<Link
								key={href}
								href={href}
								prefetch={true}
								className={clsx(
									"flex items-center rounded-lg transition-[background-color,box-shadow,color] duration-200",
									isCollapsed ? "justify-center px-3 py-3" : "gap-3 px-4 py-2.5",
									active 
										? "bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white shadow-md hover:shadow-lg" 
										: "text-[var(--foreground)] hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
								)}
								aria-current={active ? "page" : undefined}
								onClick={onClick}
								title={isCollapsed ? label : undefined}
							>
								<Icon className={clsx("h-5 w-5 flex-shrink-0 transition-colors duration-200", active ? "text-white" : "text-gray-500")} />
								{!isCollapsed && (
									<span className={clsx("text-sm font-medium whitespace-nowrap", active ? "text-white" : undefined)}>{label}</span>
								)}
							</Link>
						);
					})}
				</div>
			</div>
		));
	}, [pathname, isCollapsed, onClick, groupedItems]);

	return (
		<nav className="space-y-1">
			{navItemElements}
			<div className="border-t border-[var(--color-border)] pt-3 mt-4">
				<button
					onClick={confirmLogout}
					className={clsx(
						"w-full text-left flex items-center rounded-lg text-[var(--foreground)] hover:bg-gray-100 transition-colors",
						isCollapsed ? "justify-center px-3 py-3" : "gap-3 px-4 py-3"
					)}
					title={isCollapsed ? "Logout" : undefined}
				>
					<LogOut className="h-5 w-5 text-gray-500 flex-shrink-0" />
					{!isCollapsed && (
						<span className="text-sm font-medium">Logout</span>
					)}
				</button>
			</div>

			{/* Logout Confirmation Dialog */}
			<Dialog open={showLogoutDialog} onOpenChange={setShowLogoutDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Confirm Logout</DialogTitle>
					</DialogHeader>
					<div className="py-4">
						<p className="text-gray-600">Are you sure you want to logout?</p>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setShowLogoutDialog(false)}>
							Cancel
						</Button>
						<Button 
							onClick={handleLogout}
							className="bg-red-600 hover:bg-red-700"
						>
							Logout
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</nav>
	);
}


