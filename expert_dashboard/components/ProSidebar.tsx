"use client";

import { useMemo, useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, ClipboardCheck, BarChart3, User, LogOut, FileText, Menu, ChevronLeft, UserCheck, PieChart, BookOpen } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { useSidebar } from "./SidebarContext";
import { useUser } from "./UserContext";
import Image from "next/image";

// RBAC: Define navigation items with role requirements
const navItems = [
	// Expert navigation
	{ href: "/expert-dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ['expert'] },
	{ href: "/validate", label: "Validate", icon: ClipboardCheck, roles: ['expert'] },
	{ href: "/history", label: "History", icon: BarChart3, roles: ['expert'] },
	{ href: "/manage-disease-info", label: "Manage Disease Info", icon: BookOpen, roles: ['expert'] },
	{ href: "/profile", label: "Profile", icon: User, roles: ['expert'] },

	// Admin navigation
	{ href: "/admin-dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ['admin'] },
	{ href: "/admin-dashboard/approvals", label: "Account Approval", icon: UserCheck, roles: ['admin'] },
	{ href: "/reports", label: "Reports", icon: FileText, roles: ['admin'] },
	{ href: "/data-visualization", label: "Data Visualization", icon: PieChart, roles: ['admin'] },
	{ href: "/history", label: "History", icon: BarChart3, roles: ['admin'] },
	{ href: "/profile", label: "Profile", icon: User, roles: ['admin'] },
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
			// Only enable transitions after hydration to prevent flash
			isHydrated ? "transition-all duration-300" : "",
			isCollapsed ? "w-20" : "w-72"
		)}>
			<motion.div initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.4 }}>
				<div className="h-16 flex items-center justify-between px-4 border-b border-[var(--color-border)]">
					{/* Logo section - only visible when expanded */}
					<AnimatePresence mode="wait">
						{!isCollapsed ? (
							<motion.div
								key="expanded-logo"
								initial={{ opacity: 0, width: 0 }}
								animate={{ opacity: 1, width: "auto" }}
								exit={{ opacity: 0, width: 0 }}
								className="flex items-center gap-2 overflow-hidden flex-1"
							>
								<Image src="/logo.png" alt="Logo" width={32} height={32} className="h-8 w-8 object-contain flex-shrink-0" />
								<span className="font-semibold whitespace-nowrap">BitterScan</span>
							</motion.div>
						) : (
							<motion.button
								key="collapsed-menu"
								initial={{ opacity: 0, scale: 0.8 }}
								animate={{ opacity: 1, scale: 1 }}
								exit={{ opacity: 0, scale: 0.8 }}
								onClick={toggleCollapse}
								className="p-1.5 rounded-md hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
								aria-label="Expand sidebar"
							>
								<Menu className="h-5 w-5 text-gray-600" />
							</motion.button>
						)}
					</AnimatePresence>
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
			</motion.div>
		</aside>
	);
}

function SidebarLinks({ onClick, isCollapsed }: { onClick?: () => void; isCollapsed?: boolean }) {
	// Named function component for Fast Refresh support
	const pathname = usePathname();
	const router = useRouter();
	const [showLogoutDialog, setShowLogoutDialog] = useState(false);
	const { logout, profile } = useUser();

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

	// RBAC: Filter navigation items based on user role
	const filteredNavItems = useMemo(() => {
		if (!profile) return [];
		return navItems.filter(item => item.roles.includes(profile.role));
	}, [profile]);

	const navItemElements = useMemo(() => {
		return filteredNavItems.map(({ href, label, icon: Icon }) => {
			// Exact match for routes to prevent /admin-dashboard from matching /admin-dashboard/approvals
			const active = pathname === href;
			return (
				<Link
					key={href}
					href={href}
					prefetch={true}
					className={clsx(
						"flex items-center rounded-lg transition-all duration-200",
						isCollapsed ? "justify-center px-3 py-3" : "gap-3 px-4 py-3",
						active 
							? "bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white shadow-md hover:shadow-lg" 
							: "text-[var(--foreground)] hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
					)}
					aria-current={active ? "page" : undefined}
					onClick={onClick}
					title={isCollapsed ? label : undefined}
				>
					<Icon className={clsx("h-5 w-5 flex-shrink-0 transition-colors", active ? "text-white" : "text-gray-500")} />
					{!isCollapsed && (
						<span className={clsx("text-sm font-medium whitespace-nowrap", active ? "text-white" : undefined)}>{label}</span>
					)}
				</Link>
			);
		});
	}, [pathname, isCollapsed, onClick, filteredNavItems]);

	return (
		<nav className="space-y-1">
			{navItemElements}
			<div className="border-t border-[var(--color-border)] pt-3 mt-3">
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


