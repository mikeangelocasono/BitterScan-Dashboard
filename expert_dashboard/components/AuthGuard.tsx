"use client";

import { ReactNode, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useUser } from "./UserContext";

const SUPPRESS_AUTH_TOAST_KEY = "bs:suppress-auth-toast";
const PUBLIC_ROUTES = ["/login", "/register", "/role-select"];
const ROLE_ROUTE_MAP: Record<string, string[]> = {
  admin: ["/admin-dashboard", "/reports", "/data-visualization", "/history", "/profile", "/manage-disease-info"],
  expert: ["/expert-dashboard", "/dashboard", "/validate", "/history", "/profile", "/manage-disease-info"],
  farmer: [],
};

const ADMIN_EMAIL_HINT =
  typeof process !== "undefined" && process.env?.NEXT_PUBLIC_ADMIN_EMAIL
    ? String(process.env.NEXT_PUBLIC_ADMIN_EMAIL).toLowerCase()
    : null;

function routeAllowed(pathname: string, role: string | null): boolean {
  if (!role) return false;
  const allowed = ROLE_ROUTE_MAP[role] || [];
  if (role === "admin" && pathname.startsWith("/admin-dashboard")) return true;
  if (role === "expert" && pathname.startsWith("/expert-dashboard")) return true;
  return allowed.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export default function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, profile, loading, sessionReady, refreshProfile, loggingOut } = useUser();

  const redirectHandled = useRef(false);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const emailLower = user?.email?.toLowerCase() || "";
  const emailRoleHint = useMemo(() => {
    if (ADMIN_EMAIL_HINT && emailLower === ADMIN_EMAIL_HINT) return "admin";
    if (emailLower.includes("admin")) return "admin";
    return null;
  }, [emailLower]);

  const resolvedRole = useMemo(() => {
    return (
      profile?.role ||
      user?.user_metadata?.role ||
      (user as any)?.app_metadata?.role ||
      (user as any)?.role ||
      emailRoleHint ||
      null
    );
  }, [profile?.role, user?.user_metadata?.role, user, emailRoleHint]);

  const resolvedStatus = profile?.status || (resolvedRole === "admin" ? "approved" : null);

  // Use sessionReady instead of just loading for auth state determination
  // sessionReady is set to true only after UserContext has fully resolved session + profile
  const isAuthReady = sessionReady && !loading;

  // Prevent infinite loading: if loading persists with no user, return to role-select after 15s
  useEffect(() => {
    if (loggingOut) return; // Don't interfere during logout
    if (!isAuthReady) {
      loadingTimeoutRef.current = setTimeout(() => {
        if (!user && !PUBLIC_ROUTES.includes(pathname)) {
          console.warn('[AuthGuard] Auth loading timeout, redirecting to role-select');
          router.replace("/role-select");
        }
      }, 15000);
    } else if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    };
  }, [isAuthReady, loggingOut, pathname, router, user]);

  // Hydrate profile once the user is present
  // This ensures profile is loaded for role-based routing
  useEffect(() => {
    if (isAuthReady && user && !profile && !loggingOut) {
      console.log('[AuthGuard] User present but no profile, triggering refresh...');
      refreshProfile(user.id).catch((err) => {
        console.warn("[AuthGuard] refreshProfile failed:", err);
      });
    }
  }, [isAuthReady, profile, refreshProfile, user, loggingOut]);

  useEffect(() => {
    // Don't redirect while auth is still being determined or during logout
    if (!isAuthReady || loggingOut) return;
    if (PUBLIC_ROUTES.includes(pathname)) {
      redirectHandled.current = false;
      return;
    }

    // No user: push to login
    if (!user) {
      if (!redirectHandled.current) {
        redirectHandled.current = true;
        const suppress =
          typeof window !== "undefined" && sessionStorage.getItem(SUPPRESS_AUTH_TOAST_KEY) === "true";
        const fromLogout =
          typeof window !== "undefined" && sessionStorage.getItem('bs:from-logout') === "true";
        // Don't show toast - removed to prevent notification after logout
        // if (!suppress && !fromLogout) {
        //   toast.error("Please log in to continue.");
        // }
        // Clear the flags after checking
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(SUPPRESS_AUTH_TOAST_KEY);
          sessionStorage.removeItem('bs:from-logout');
        }
        router.replace("/role-select");
      }
      return;
    }

    // Farmers are blocked entirely
    if (resolvedRole === "farmer") {
      if (!redirectHandled.current) {
        redirectHandled.current = true;
        toast.error("This application is not available for farmer accounts. Please use the mobile app.");
        router.replace("/role-select");
      }
      return;
    }

    // Pending (non-admin) users are blocked
    if (resolvedRole !== "admin" && resolvedStatus && resolvedStatus !== "approved") {
      if (!redirectHandled.current) {
        redirectHandled.current = true;
        toast.error("Your account is pending approval. Please contact an administrator.");
        router.replace("/role-select");
      }
      return;
    }

    // If role unresolved but admin email hint matches and user heads to admin dashboard, allow pass-through
    if (!resolvedRole && emailRoleHint === "admin" && pathname.startsWith("/admin-dashboard")) {
      redirectHandled.current = false;
      return;
    }

    // If we know the role, enforce route-level access
    if (resolvedRole) {
      const allowed = routeAllowed(pathname, resolvedRole);
      if (!allowed) {
        if (!redirectHandled.current) {
          redirectHandled.current = true;
          toast.error("You do not have permission to access this page.");
          const target = resolvedRole === "admin" ? "/admin-dashboard" : "/expert-dashboard";
          router.replace(target);
        }
        return;
      }
    } else {
      // Role not yet known: keep spinner to avoid flashing unauthorized screens
      return;
    }

    // If we reach here, user is authorized for this route
    redirectHandled.current = false;
  }, [emailRoleHint, isAuthReady, loggingOut, pathname, profile?.status, resolvedRole, resolvedStatus, router, user]);

  // Show centered logout modal overlay during logout transition
  if (loggingOut) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-3 min-w-[260px] animate-[fadeScaleIn_0.25s_ease-out]">
          <div className="h-11 w-11 rounded-full border-[3.5px] border-[#388E3C] border-t-transparent animate-spin" />
          <p className="text-base font-semibold text-gray-900 mt-1">Logging out…</p>
          <p className="text-sm text-gray-500">Please wait</p>
        </div>
      </div>
    );
  }

  // Show loading spinner while auth state is being determined
  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="text-center">
          <div className="h-10 w-10 rounded-full border-4 border-[#388E3C] border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // User exists but profile/role unresolved: show lightweight loader with retry
  if (user && !resolvedRole && !profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="text-center">
          <div className="h-10 w-10 rounded-full border-4 border-[#388E3C] border-t-transparent animate-spin mx-auto mb-4" />
          <p className="text-sm text-gray-600">Loading profile...</p>
          <div className="mt-4 flex justify-center gap-2">
            <button
              className="px-3 py-1.5 text-sm rounded-md border border-green-200 text-[#388E3C] hover:bg-green-50"
              onClick={() => {
                if (user) {
                  refreshProfile(user.id).catch((err) => {
                    console.error('[AuthGuard] Retry profile fetch failed:', err);
                  });
                }
              }}
            >
              Retry
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
              onClick={() => router.replace("/role-select")}
            >
              Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Authorized: render children
  return <>{children}</>;
}

