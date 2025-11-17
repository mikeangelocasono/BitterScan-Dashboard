import { ReactNode } from "react";
import { clsx } from "clsx";

export function Card({ className, children }: { className?: string; children?: ReactNode }) {
    return <div className={clsx("bg-[var(--surface)] border border-[var(--color-border)] rounded-xl shadow-sm", className)}>{children}</div>;
}

export function CardHeader({ className, children }: { className?: string; children?: ReactNode }) {
    return <div className={clsx("px-5 pt-5", className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children?: ReactNode }) {
    return <h3 className={clsx("text-base font-semibold text-[var(--foreground)]", className)}>{children}</h3>;
}

export function CardContent({ className, children }: { className?: string; children?: ReactNode }) {
    return <div className={clsx("px-5 pb-5", className)}>{children}</div>;
}


