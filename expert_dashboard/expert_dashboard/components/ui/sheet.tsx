"use client";

import { ReactNode } from "react";
import { clsx } from "clsx";

export function Sheet({ open, onOpenChange, children }: { open: boolean; onOpenChange: (v: boolean) => void; children: ReactNode }) {
	return (
        <div className={clsx("fixed inset-0 z-50 pointer-events-none", open ? "" : "")}
            aria-hidden={!open}
        >
            {/* Backdrop with fade */}
            <div 
                className={clsx(
                    "absolute inset-0 bg-black/40 transition-opacity duration-300 ease-out pointer-events-auto",
                    open ? "opacity-100" : "opacity-0 pointer-events-none"
                )} 
                onClick={() => onOpenChange(false)} 
            />
            {/* Sliding drawer */}
            <div 
                className={clsx(
                    "absolute top-0 left-0 h-full w-80 bg-[var(--surface)] text-[var(--foreground)] shadow-xl border-r border-[var(--color-border)] transform transition-transform duration-300 ease-out pointer-events-auto",
                    open ? "translate-x-0" : "-translate-x-full"
                )}
            >
                {children}
            </div>
        </div>
	);
}


