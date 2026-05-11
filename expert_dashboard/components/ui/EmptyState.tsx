"use client";

import { memo } from "react";
import { InboxIcon } from "lucide-react";
import { clsx } from "clsx";

interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={clsx("flex flex-col items-center justify-center py-12 px-4", className)}>
      <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
        <Icon className="h-7 w-7 text-gray-400" />
      </div>
      <p className="text-gray-600 font-medium text-sm">{title}</p>
      {description && (
        <p className="text-gray-400 text-xs mt-1.5 text-center max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export default memo(EmptyState);
