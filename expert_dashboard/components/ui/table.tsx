import { ReactNode } from "react";
import { clsx } from "clsx";

export function Table({ className, children }: { className?: string; children?: ReactNode }) {
    return <table className={clsx("min-w-full text-sm rounded-xl overflow-hidden bg-[var(--surface)] border border-[var(--color-border)] shadow-sm", className)}>{children}</table>;
}

export function Thead({ children }: { children?: ReactNode }) {
    return <thead className="bg-gray-50 text-[var(--foreground)]/80 font-semibold">{children}</thead>;
}

export function Tbody({ children }: { children?: ReactNode }) {
    return <tbody className="bg-[var(--surface)] divide-y divide-gray-100">{children}</tbody>;
}

export function Tr({ className, children, onClick }: { className?: string; children?: ReactNode; onClick?: () => void }) {
    return <tr className={clsx("border-t border-[var(--color-border)] transition-colors hover:bg-gray-50 even:bg-gray-50/50", className)} onClick={onClick}>{children}</tr>;
}

export function Th({ className, children }: { className?: string; children?: ReactNode }) {
    return <th className={clsx("px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider", className)}>{children}</th>;
}

export function Td({ className, children, onClick }: { className?: string; children?: ReactNode; onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void }) {
    return <td className={clsx("px-4 py-3 text-sm text-[var(--foreground)]", className)} onClick={onClick}>{children}</td>;
}


