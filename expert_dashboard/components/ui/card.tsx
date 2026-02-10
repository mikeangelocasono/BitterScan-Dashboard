import { ReactNode, CSSProperties } from "react";
import { clsx } from "clsx";

export function Card({ className, children }: { className?: string; children?: ReactNode }) {
    return <div className={clsx("bg-[var(--surface)] border border-[var(--color-border)] rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200", className)}>{children}</div>;
}

export function CardHeader({ className, children }: { className?: string; children?: ReactNode }) {
    return <div className={clsx("px-6 pt-6 pb-4", className)}>{children}</div>;
}

export function CardTitle({ className, children, style }: { className?: string; children?: ReactNode; style?: CSSProperties }) {
    return <h3 className={clsx("text-lg font-semibold tracking-tight", className)} style={style}>{children}</h3>;
}

export function CardContent({ className, children }: { className?: string; children?: ReactNode }) {
    return <div className={clsx("px-6 pb-6", className)}>{children}</div>;
}


