"use client";

import { useEffect } from 'react';

/**
 * ChunkErrorHandler - Automatically handles chunk load errors
 * 
 * This component listens for chunk loading errors and automatically
 * reloads the page to retry loading the chunks. This is a common
 * issue in Next.js when the build cache gets corrupted or when
 * there are network issues.
 */
export default function ChunkErrorHandler() {
  useEffect(() => {
    // Handle chunk load errors and retry
    const handleError = (e: ErrorEvent) => {
      if (e.message && e.message.includes('Loading chunk') && e.message.includes('failed')) {
        console.warn('Chunk load error detected, reloading page...');
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    };

    // Handle unhandled promise rejections (chunk load errors)
    const handleRejection = (e: PromiseRejectionEvent) => {
      if (e.reason && e.reason.message && e.reason.message.includes('Loading chunk')) {
        console.warn('Chunk load error in promise, reloading page...');
        e.preventDefault();
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      }
    };

    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleRejection);

    return () => {
      window.removeEventListener('error', handleError, true);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null;
}

