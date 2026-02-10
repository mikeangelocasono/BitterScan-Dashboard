"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo } from "react";

interface SidebarContextType {
	isCollapsed: boolean;
	toggleCollapse: () => void;
	sidebarWidth: number;
	isHydrated: boolean;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
	// Start with null to indicate "not yet hydrated"
	const [isCollapsed, setIsCollapsed] = useState<boolean | null>(null);
	const [isHydrated, setIsHydrated] = useState(false);

	// Read from localStorage only once on mount
	useEffect(() => {
		const savedState = localStorage.getItem("sidebarCollapsed");
		setIsCollapsed(savedState !== null ? JSON.parse(savedState) : false);
		setIsHydrated(true);
	}, []);

	const toggleCollapse = useCallback(() => {
		setIsCollapsed((prev) => {
			const newState = !prev;
			localStorage.setItem("sidebarCollapsed", JSON.stringify(newState));
			return newState;
		});
	}, []);

	// Use false as default until hydrated
	const effectiveIsCollapsed = isCollapsed ?? false;
	const sidebarWidth = effectiveIsCollapsed ? 80 : 288; // 20 * 4 = 80px (w-20), 72 * 4 = 288px (w-72)

	const value = useMemo(() => ({
		isCollapsed: effectiveIsCollapsed,
		toggleCollapse,
		sidebarWidth,
		isHydrated,
	}), [effectiveIsCollapsed, toggleCollapse, sidebarWidth, isHydrated]);

	return (
		<SidebarContext.Provider value={value}>
			{children}
		</SidebarContext.Provider>
	);
}

export function useSidebar() {
	const context = useContext(SidebarContext);
	if (context === undefined) {
		throw new Error("useSidebar must be used within a SidebarProvider");
	}
	return context;
}

