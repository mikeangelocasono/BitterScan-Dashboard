"use client";

import { ReactNode } from 'react';
import ErrorBoundary from './ErrorBoundary';

// Production error boundary wrapper to catch and handle React errors gracefully
export default function ErrorBoundaryWrapper({ children }: { children: ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

