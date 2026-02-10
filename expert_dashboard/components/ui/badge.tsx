import { clsx } from "clsx";

type BadgeProps = {
  children: React.ReactNode;
  color?: "green" | "red" | "amber" | "gray" | "blue" | "purple";
  className?: string;
};

export default function Badge({ children, color = "gray", className }: BadgeProps) {
  const styles: Record<string, string> = {
    green: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    red: "bg-red-50 text-red-700 border border-red-200",
    amber: "bg-amber-50 text-amber-700 border border-amber-200",
    gray: "bg-gray-50 text-gray-700 border border-gray-200",
    blue: "bg-blue-50 text-blue-700 border border-blue-200",
    purple: "bg-purple-50 text-purple-700 border border-purple-200",
  };
  return (
    <span className={clsx("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold transition-colors", styles[color], className)}>
      {children}
    </span>
  );
}


