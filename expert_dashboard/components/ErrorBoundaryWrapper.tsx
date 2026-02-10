"use client";

import { ReactNode } from 'react';

// Lightweight pass-through wrapper to avoid boundary loading issues
export default function ErrorBoundaryWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

