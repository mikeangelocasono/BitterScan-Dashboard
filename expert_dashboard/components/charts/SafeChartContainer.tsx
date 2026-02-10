"use client";

import { ReactNode, useRef, useState, useEffect, useCallback } from "react";
import { ResponsiveContainer } from "recharts";

type SafeChartContainerProps = {
  children: ReactNode;
  width?: string | number;
  height: number;
  minHeight?: number;
  fallback?: ReactNode;
  className?: string;
};

/**
 * SafeChartContainer - A wrapper around ResponsiveContainer that prevents
 * chart rendering errors when container dimensions are invalid.
 * 
 * This component solves the "width(-1) and height(-1)" error that occurs when:
 * - Charts render before the container is mounted/visible
 * - The page is hidden (alt-tab, visibility change)
 * - The container has no defined dimensions
 * 
 * Features:
 * - Waits for valid container dimensions before rendering
 * - Re-renders charts when tab becomes visible
 * - Provides fallback UI while waiting for valid dimensions
 * - Prevents crashes from invalid dimensions
 */
export default function SafeChartContainer({
  children,
  width = "100%",
  height,
  minHeight,
  fallback,
  className = "",
}: SafeChartContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [key, setKey] = useState(0); // Force re-render key

  // Check if container has valid dimensions
  const checkDimensions = useCallback(() => {
    if (!containerRef.current) return false;
    const rect = containerRef.current.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, []);

  // Initialize - check dimensions after mount
  useEffect(() => {
    // Use requestAnimationFrame to ensure layout is complete
    let rafId: number;
    let attempts = 0;
    const maxAttempts = 10;

    const attemptCheck = () => {
      if (checkDimensions()) {
        setIsReady(true);
      } else if (attempts < maxAttempts) {
        attempts++;
        rafId = requestAnimationFrame(attemptCheck);
      } else {
        // After max attempts, assume ready (ResponsiveContainer will handle)
        setIsReady(true);
      }
    };

    // Initial delay to allow layout to stabilize
    const timeoutId = setTimeout(() => {
      rafId = requestAnimationFrame(attemptCheck);
    }, 50);

    return () => {
      clearTimeout(timeoutId);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [checkDimensions]);

  // Handle visibility changes - re-render chart when tab becomes visible
  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      const nowVisible = document.visibilityState === "visible";
      setIsVisible(nowVisible);

      if (nowVisible) {
        // Force re-render when becoming visible to recalculate dimensions
        // Small delay to allow browser to restore layout
        setTimeout(() => {
          if (checkDimensions()) {
            setKey((prev) => prev + 1);
          }
        }, 100);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkDimensions]);

  // Handle window resize - recalculate dimensions
  useEffect(() => {
    if (typeof window === "undefined") return;

    let resizeTimeout: NodeJS.Timeout;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (checkDimensions()) {
          setKey((prev) => prev + 1);
        }
      }, 150);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(resizeTimeout);
      window.removeEventListener("resize", handleResize);
    };
  }, [checkDimensions]);

  const effectiveHeight = minHeight ? Math.max(height, minHeight) : height;

  // Default fallback - empty placeholder with same height
  const defaultFallback = (
    <div
      className="flex items-center justify-center bg-gray-50 rounded-lg"
      style={{ height: effectiveHeight, minHeight: effectiveHeight }}
    >
      <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        minHeight: effectiveHeight,
        height: effectiveHeight,
        width: typeof width === "number" ? width : undefined,
      }}
    >
      {isReady && isVisible ? (
        <ResponsiveContainer
          key={key}
          width={width}
          height={effectiveHeight}
          minHeight={minHeight}
        >
          {children}
        </ResponsiveContainer>
      ) : (
        fallback || defaultFallback
      )}
    </div>
  );
}
