"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Role Select Page - DEPRECATED
 * This page now redirects directly to /login.
 * Role detection is handled automatically during login.
 */
export default function RoleSelectPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to login page immediately
    // Role selection is no longer needed - role is auto-detected on login
    router.replace("/login");
  }, [router]);

  // Show loading spinner while redirecting
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="h-10 w-10 border-4 border-[#388E3C] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600 text-sm">Redirecting to login...</p>
      </div>
    </div>
  );
}
