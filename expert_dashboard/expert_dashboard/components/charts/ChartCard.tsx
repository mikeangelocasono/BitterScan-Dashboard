"use client";

import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ReactNode } from "react";

export default function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="shadow-sm hover:shadow-lg transition-all duration-200 border border-gray-200">
      <CardHeader className="pb-4 border-b border-gray-100">
        <CardTitle className="text-lg font-semibold text-gray-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-6">{children}</CardContent>
    </Card>
  );
}

