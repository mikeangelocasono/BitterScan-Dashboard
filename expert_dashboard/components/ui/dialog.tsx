"use client";

import { ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (v: boolean) => void; children: ReactNode }) {
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onOpenChange(false);
		}
		if (open) document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onOpenChange]);

	if (typeof document === "undefined") return null;
	return createPortal(
		<div className={clsx("fixed inset-0 z-50", open ? "" : "hidden")}
			aria-hidden={!open}
		>
			<div className="absolute inset-0 bg-black/40 transition-opacity duration-200" onClick={() => onOpenChange(false)} />
			<div className="relative z-10 flex items-center justify-center min-h-screen p-4">
				<div className="w-full max-w-lg sm:max-w-2xl bg-[var(--surface)] rounded-xl shadow-lg border border-[var(--color-border)] transform transition-all duration-200 ease-out scale-95 opacity-0 data-[open]:scale-100 data-[open]:opacity-100" data-open={open ? "true" : undefined}>
					{children}
				</div>
			</div>
		</div>,
		document.body
	);
}

export function DialogHeader({ children, className }: { children?: ReactNode; className?: string }) {
	return <div className={clsx("px-5 pt-5 pb-2 border-b border-[var(--color-border)]", className)}>{children}</div>;
}

export function DialogTitle({ children, className }: { children?: ReactNode; className?: string }) {
	return <h3 className={clsx("text-base font-semibold text-[var(--foreground)]", className)}>{children}</h3>;
}

export function DialogDescription({ children, className }: { children?: ReactNode; className?: string }) {
	return <p className={clsx("text-sm text-gray-600 mt-1", className)}>{children}</p>;
}

export function DialogContent({ children, className }: { children?: ReactNode; className?: string }) {
	return <div className={clsx("px-5 py-4", className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children?: ReactNode; className?: string }) {
	return <div className={clsx("px-5 py-4 flex justify-end gap-3 border-t border-[var(--color-border)]", className)}>{children}</div>;
}


