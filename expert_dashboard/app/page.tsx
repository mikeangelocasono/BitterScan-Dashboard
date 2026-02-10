"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/UserContext";

export default function Home() {
  const router = useRouter();
  const { user, profile, loading, sessionReady } = useUser();
  const [forceRedirect, setForceRedirect] = useState(false);

  // Master timeout: if page is stuck loading for more than 5s, force redirect to role-select
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!sessionReady) {
        console.warn('[Home] Forcing redirect to role-select after timeout');
        setForceRedirect(true);
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [sessionReady]);

  useEffect(() => {
    // Force redirect if timeout occurred
    if (forceRedirect) {
      router.replace('/role-select');
      return;
    }

    // Wait for session to be fully ready (not just loading to be false)
    if (!sessionReady) return;

    // If user is authenticated, redirect to their dashboard
    if (user && profile) {
      if (profile.role === 'admin') {
        router.replace('/admin-dashboard');
      } else if (profile.role === 'expert') {
        router.replace('/expert-dashboard');
      } else {
        // Unknown role or farmer - go to role select
        router.replace('/role-select');
      }
    } else {
      // No active session - go to role select
      router.replace('/role-select');
    }
  }, [user, profile, sessionReady, forceRedirect, router]);

  // Show loading state while checking authentication
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <div className="h-10 w-10 border-4 border-[#388E3C] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-600 text-sm">Loading...</p>
      </div>
    </div>
  );
}