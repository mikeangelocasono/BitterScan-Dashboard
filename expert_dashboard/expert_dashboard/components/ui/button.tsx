"use client";

import { ButtonHTMLAttributes, forwardRef, useRef, useCallback } from "react";
import { clsx } from "clsx";

type Variant = "default" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: Variant;
	size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant = "default", size = "md", onClick, disabled, ...props }, ref) => {
		const isProcessingRef = useRef(false);
		
		const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
			// Prevent double-clicks and rapid clicks
			if (disabled || isProcessingRef.current) {
				e.preventDefault();
				return;
			}
			
			// Set processing flag immediately for instant feedback
			isProcessingRef.current = true;
			
			// Call original onClick
			if (onClick) {
				onClick(e);
			}
			
			// Reset after a short delay to allow for async operations
			setTimeout(() => {
				isProcessingRef.current = false;
			}, 300);
		}, [onClick, disabled]);
		
        const base = "inline-flex items-center justify-center rounded-lg font-medium transition-all duration-150 focus:outline-none disabled:opacity-50 disabled:pointer-events-none shadow-sm active:scale-[0.98]";
		const variants: Record<Variant, string> = {
            default: "bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] active:bg-[var(--primary-700)]",
            outline: "border border-[var(--color-border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-gray-50 active:bg-gray-100",
            ghost: "bg-transparent hover:bg-gray-100 text-[var(--foreground)] active:bg-gray-200",
		};
		const sizes: Record<Size, string> = {
            sm: "h-8 px-3 text-sm",
            md: "h-10 px-4 text-sm",
            lg: "h-11 px-5 text-base",
		};
		return (
			<button 
				ref={ref} 
				className={clsx(base, variants[variant], sizes[size], className)} 
				onClick={handleClick}
				disabled={disabled || isProcessingRef.current}
				{...props} 
			/>
		);
	}
);

Button.displayName = "Button";


