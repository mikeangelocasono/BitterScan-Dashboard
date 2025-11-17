"use client";

import { useMemo, useCallback, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, ClipboardCheck, BarChart3, User, LogOut, FileText, Menu, ChevronLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { clsx } from "clsx";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { useSidebar } from "./SidebarContext";
import { useUser } from "./UserContext";

const nav = [
	{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ href: "/validate", label: "Validate", icon: ClipboardCheck },
	{ href: "/reports", label: "Reports", icon: FileText },
	{ href: "/history", label: "History", icon: BarChart3 },
	{ href: "/profile", label: "Profile", icon: User },
];

export function MobileSidebar({ onClose }: { onClose: () => void }) {
    return (
        <div className="h-full bg-[var(--surface)] text-[var(--foreground)] p-4">
            <SidebarLinks onClick={onClose} />
        </div>
    );
}

export default function ProSidebar() {
	const { isCollapsed, toggleCollapse } = useSidebar();

	return (
		<aside className={clsx(
			"h-screen bg-[var(--surface)] text-[var(--foreground)] border-r border-[var(--color-border)] shadow-sm transition-all duration-300",
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
								<img src="/logo.png" alt="Logo" className="h-8 w-8 object-contain flex-shrink-0" />
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
	const { logout } = useUser();

	const handleLogout = useCallback(async () => {
		try {
			await logout();
			toast.success("Successfully logged out.");
			router.replace("/login");
			onClick?.();
		} catch {
			toast.error("Error logging out. Please try again.");
		}
	}, [logout, router, onClick]);

	const confirmLogout = useCallback(() => {
		setShowLogoutDialog(true);
	}, []);

	const navItems = useMemo(() => {
		return nav.map(({ href, label, icon: Icon }) => {
			const active = pathname === href || pathname.startsWith(href + "/");
			return (
				<Link
					key={href}
					href={href}
					prefetch={true}
					className={clsx(
						"flex items-center rounded-lg transition-colors",
						isCollapsed ? "justify-center px-3 py-3" : "gap-3 px-4 py-3",
						active 
							? "bg-[var(--primary)] text-white" 
							: "text-[var(--foreground)] hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
					)}
					aria-current={active ? "page" : undefined}
					onClick={onClick}
					title={isCollapsed ? label : undefined}
				>
					<Icon className={clsx("h-5 w-5 flex-shrink-0", active ? "text-white" : "text-gray-500")} />
					{!isCollapsed && (
						<span className="text-sm font-medium whitespace-nowrap">{label}</span>
					)}
				</Link>
			);
		});
	}, [pathname, isCollapsed, onClick]);

	return (
		<nav className="space-y-1">
			{navItems}
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
							No
						</Button>
						<Button 
							onClick={() => {
								setShowLogoutDialog(false);
								handleLogout();
							}}
							className="bg-red-600 hover:bg-red-700"
						>
							Yes
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</nav>
	);
}


