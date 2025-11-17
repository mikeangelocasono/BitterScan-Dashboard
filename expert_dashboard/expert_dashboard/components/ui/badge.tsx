import { clsx } from "clsx";

type BadgeProps = {
  children: React.ReactNode;
  color?: "green" | "red" | "amber" | "gray" | "blue";
  className?: string;
};

export default function Badge({ children, color = "gray", className }: BadgeProps) {
  const styles: Record<string, string> = {
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-700",
    gray: "bg-gray-100 text-gray-700",
    blue: "bg-blue-100 text-blue-700",
  };
  return (
    <span className={clsx("inline-flex items-center px-2 py-1 rounded-md text-xs font-medium", styles[color], className)}>
      {children}
    </span>
  );
}


