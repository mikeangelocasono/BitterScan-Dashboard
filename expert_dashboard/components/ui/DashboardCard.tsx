"use client";

import { memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { clsx } from "clsx";

interface DashboardCardProps {
  title: string;
  description?: string;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

function DashboardCard({
  title,
  description,
  headerAction,
  children,
  className,
  noPadding,
}: DashboardCardProps) {
  return (
    <Card className={clsx("shadow-sm border border-gray-200 hover:shadow-md transition-all duration-200 bg-white rounded-xl overflow-hidden", className)}>
      <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 border-b rounded-t-xl">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-lg font-bold" style={{ color: 'white' }}>{title}</CardTitle>
            {description && (
              <p className="text-sm mt-1" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>{description}</p>
            )}
          </div>
          {headerAction && <div className="flex-shrink-0">{headerAction}</div>}
        </div>
      </CardHeader>
      <CardContent className={clsx(noPadding ? "p-0" : "p-6")}>
        {children}
      </CardContent>
    </Card>
  );
}

export default memo(DashboardCard);
