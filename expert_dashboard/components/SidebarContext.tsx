"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface SidebarContextType {
	isCollapsed: boolean;
	toggleCollapse: () => void;
	sidebarWidth: number;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
	const [isCollapsed, setIsCollapsed] = useState(false);

	useEffect(() => {
		const savedState = localStorage.getItem("sidebarCollapsed");
		if (savedState !== null) {
			setIsCollapsed(JSON.parse(savedState));
		}
	}, []);

	const toggleCollapse = () => {
		const newState = !isCollapsed;
		setIsCollapsed(newState);
		localStorage.setItem("sidebarCollapsed", JSON.stringify(newState));
	};

	const sidebarWidth = isCollapsed ? 80 : 288; // 20 * 4 = 80px (w-20), 72 * 4 = 288px (w-72)

	return (
		<SidebarContext.Provider value={{ isCollapsed, toggleCollapse, sidebarWidth }}>
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

