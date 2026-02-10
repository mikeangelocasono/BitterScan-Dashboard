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
    <Card className="shadow-lg hover:shadow-xl transition-all duration-300 border border-gray-200 rounded-xl overflow-hidden bg-white">
      <CardHeader className="pb-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold text-gray-900">{title}</CardTitle>
          {action && <div>{action}</div>}
        </div>
      </CardHeader>
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}

