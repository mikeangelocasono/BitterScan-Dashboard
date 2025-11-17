"use client";

import { ReactNode, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useUser } from "./UserContext";
import toast from "react-hot-toast";

const SUPPRESS_AUTH_TOAST_KEY = "bs:suppress-auth-toast";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile, loading } = useUser();
  const redirectHandled = useRef(false);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Add timeout for loading state to prevent infinite loading
  useEffect(() => {
    if (loading) {
      // Set a timeout to prevent infinite loading
      loadingTimeoutRef.current = setTimeout(() => {
        console.warn('[AuthGuard] Loading timeout - user context may be stuck');
        // Don't redirect here - let the normal flow handle it
      }, 10000); // 10 second timeout
    } else {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    }

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [loading]);

  useEffect(() => {
    if (loading) return;

    // Prevent multiple redirects
    if (redirectHandled.current) return;

    // Don't redirect if already on login page
    if (pathname === "/login" || pathname === "/register") {
      redirectHandled.current = false;
      return;
    }

    if (!user) {
      redirectHandled.current = true;
      let shouldSuppressToast = false;

      if (typeof window !== "undefined") {
        shouldSuppressToast = sessionStorage.getItem(SUPPRESS_AUTH_TOAST_KEY) === "true";
        if (shouldSuppressToast) {
          sessionStorage.removeItem(SUPPRESS_AUTH_TOAST_KEY);
        }
      }

      if (!shouldSuppressToast) {
        toast.error("Please log in to continue.");
      }

      router.replace("/login");
      return;
    }

    // Only check role if profile exists and is loaded
    if (profile && profile.role !== "expert") {
      redirectHandled.current = true;
      toast.error("You are not allowed to log in here because your role does not match.");
      router.replace("/login");
      return;
    }

    // Reset redirect flag when user is valid
    if (user && (!profile || profile.role === "expert")) {
      redirectHandled.current = false;
    }
  }, [loading, user, profile, router, pathname]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="text-center">
          <div className="h-10 w-10 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Allow access if user exists and either no profile yet (still loading) or profile has expert role
  if (!user || (profile && profile.role !== "expert")) return null;
  return <>{children}</>;
}

