"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { User, LogOut, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useUser } from "./UserContext";
import toast from "react-hot-toast";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import Link from "next/link";
import Image from "next/image";

export default function AccountDropdown() {
	const [isOpen, setIsOpen] = useState(false);
	const [showLogoutDialog, setShowLogoutDialog] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const { user, profile, logout } = useUser();
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

	const displayName = useMemo(() => {
		if (profile?.full_name) return profile.full_name;
		if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
		// Role-aware fallback instead of hardcoded "Expert"
		const role = profile?.role || user?.user_metadata?.role;
		if (role === 'admin') return 'Admin';
		if (role === 'expert') return 'Expert';
		if (role === 'farmer') return 'Farmer';
		return 'User';
	}, [profile?.full_name, profile?.role, user?.user_metadata?.full_name, user?.user_metadata?.role]);

	const userInitials = useMemo(() => {
		if (profile?.full_name) {
			return profile.full_name
				.split(" ")
				.map((n: string) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2);
		}
		if (user?.user_metadata?.full_name) {
			return user.user_metadata.full_name
				.split(" ")
				.map((n: string) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2);
		}
		// Role-aware fallback initials
		const role = profile?.role || user?.user_metadata?.role;
		if (role === 'admin') return 'AD';
		if (role === 'expert') return 'EX';
		if (role === 'farmer') return 'FA';
		return 'US';
	}, [profile?.full_name, profile?.role, user?.user_metadata?.full_name, user?.user_metadata?.role]);

	const handleLogout = useCallback(async () => {
		setShowLogoutDialog(false);
		try {
			await logout(); // Handles session cleanup and redirect internally
		} catch {
			toast.error("Error logging out. Please try again.");
		}
	}, [logout]);

	const handleCloseMenu = useCallback(() => {
		setIsOpen(false);
	}, []);

	const menuItems = useMemo(
		() => [
			{
				icon: User,
				label: "Profile",
				href: "/profile",
				onClick: handleCloseMenu,
			},
		],
		[handleCloseMenu]
	);

	return (
		<>
			<div className="relative" ref={dropdownRef}>
				<button
					onClick={() => setIsOpen(!isOpen)}
					className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
					aria-label="Account menu"
				>
					<div className="h-8 w-8 rounded-full bg-[var(--primary)] text-white flex items-center justify-center text-sm font-semibold">
						{profile?.profile_picture ? (
							<Image
								src={profile.profile_picture}
								alt={displayName}
								width={32}
								height={32}
								className="h-8 w-8 rounded-full object-cover"
								onError={(e) => {
									e.currentTarget.style.display = "none";
								}}
							/>
						) : (
							userInitials
						)}
					</div>
					<span className="hidden md:block text-sm font-medium text-[var(--foreground)]">
						{displayName}
					</span>
					<ChevronDown
						className={`h-4 w-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
					/>
				</button>

				<AnimatePresence>
					{isOpen && (
						<motion.div
							initial={{ opacity: 0, y: -10, scale: 0.95 }}
							animate={{ opacity: 1, y: 0, scale: 1 }}
							exit={{ opacity: 0, y: -10, scale: 0.95 }}
							transition={{ duration: 0.2 }}
							className="absolute right-0 mt-2 w-56 bg-[var(--surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 overflow-hidden"
						>
							<div className="p-2 border-b border-[var(--color-border)]">
								<div className="px-3 py-2">
									<p className="text-sm font-semibold text-[var(--foreground)]">{displayName}</p>
									<p className="text-xs text-gray-500 truncate">{profile?.email || user?.email || ""}</p>
								</div>
							</div>

							<div className="py-1">
								{menuItems.map((item) => {
									const Icon = item.icon;
									return (
										<Link
											key={item.label}
											href={item.href}
											onClick={item.onClick}
											className="flex items-center gap-3 px-4 py-2 text-sm text-[var(--foreground)] hover:bg-gray-100 transition-colors"
										>
											<Icon className="h-4 w-4 text-gray-500" />
											<span>{item.label}</span>
										</Link>
									);
								})}
							</div>

							<div className="border-t border-[var(--color-border)] py-1">
								<button
									onClick={() => {
										setIsOpen(false);
										setShowLogoutDialog(true);
									}}
									className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
								>
									<LogOut className="h-4 w-4" />
									<span>Logout</span>
								</button>
							</div>
						</motion.div>
					)}
				</AnimatePresence>
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
		</>
	);
}

