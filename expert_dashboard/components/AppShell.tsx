"use client";

import { PropsWithChildren, useState, useMemo, useCallback, memo } from "react";
import ProSidebar, { MobileSidebar } from "./ProSidebar";
import { Sheet } from "./ui/sheet";
import { Button } from "./ui/button";
import { Menu } from "lucide-react";
import AccountDropdown from "./AccountDropdown";
import NotificationBell from "./NotificationBell";
import { useSidebar } from "./SidebarContext";
import { clsx } from "clsx";

const AppShellContent = memo(function AppShellContent({ children }: PropsWithChildren) {
	// Named function component for Fast Refresh support
	const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
	const { isCollapsed, isHydrated } = useSidebar();

	const handleMobileMenuClose = useCallback(() => {
		setMobileMenuOpen(false);
	}, []);

	const handleMobileMenuOpen = useCallback(() => {
		setMobileMenuOpen(true);
	}, []);

	const contentAreaClassName = useMemo(
		() =>
			clsx(
				"flex-1 w-full",
				// Only enable transitions after hydration to prevent flash
				isHydrated ? "transition-all duration-300 ease-in-out" : "",
				isCollapsed ? "lg:pl-20" : "lg:pl-72"
			),
		[isCollapsed, isHydrated]
	);

	return (
		<div className="min-h-screen bg-[var(--background)]">
			<div className="flex">
				{/* Fixed Sidebar on large screens */}
				<aside className="hidden lg:block lg:fixed lg:inset-y-0 lg:left-0 lg:z-30">
					<ProSidebar />
				</aside>

                {/* Mobile menu button */}
                <div className="lg:hidden fixed top-4 left-4 z-40">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleMobileMenuOpen}
                        className="bg-[var(--surface)] shadow-md"
                        aria-label="Open menu"
                    >
                        <Menu className="h-4 w-4" />
                    </Button>
                </div>

                {/* Mobile Sidebar Drawer */}
                <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                    <div className="h-full bg-[var(--surface)] text-[var(--foreground)] p-4">
                        <MobileSidebar onClose={handleMobileMenuClose} />
                    </div>
                </Sheet>

				{/* Content area */}
				<div className={contentAreaClassName}>
					{/* Header with account */}
					<header className="sticky top-0 z-40 bg-[var(--surface)] border-b border-[var(--color-border)] shadow-sm h-16">
						<div className="flex items-center justify-end gap-3 px-4 md:px-6 lg:px-8 h-full">
							<NotificationBell />
							<AccountDropdown />
						</div>
					</header>
					<main className="p-4 md:p-6 lg:p-8 max-w-full">
						{children}
					</main>
				</div>
			</div>
		</div>
	);
});

AppShellContent.displayName = "AppShellContent";

export default function AppShell({ children }: PropsWithChildren) {
	// SidebarProvider is now in root layout, no need to wrap here
	return <AppShellContent>{children}</AppShellContent>;
}


