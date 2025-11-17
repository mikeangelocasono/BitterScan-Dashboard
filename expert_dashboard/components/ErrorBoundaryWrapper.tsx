"use client";

import React, { ReactNode } from 'react';
import ErrorBoundary from '@/components/ErrorBoundary';

export default function ErrorBoundaryWrapper({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

