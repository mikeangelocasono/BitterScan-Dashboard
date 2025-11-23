"use client";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ReactNode } from "react";

export default function ChartCard({ 
  title, 
  children, 
  action 
}: { 
  title: string; 
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Card className="shadow-sm hover:shadow-lg transition-all duration-200 border border-gray-200">
      <CardHeader className="pb-4 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold text-gray-900">{title}</CardTitle>
          {action && <div>{action}</div>}
        </div>
      </CardHeader>
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}

