"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@/components/UserContext";

export default function Home() {
  const router = useRouter();
  const { user, profile, loading, sessionReady } = useUser();
  const [forceRedirect, setForceRedirect] = useState(false);

  // Master timeout: if page is stuck loading for more than 5s, force redirect to login
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!sessionReady) {
        console.warn('[Home] Forcing redirect to login after timeout');
        setForceRedirect(true);
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [sessionReady]);

  useEffect(() => {
    // Force redirect if timeout occurred
    if (forceRedirect) {
      router.replace('/login');
      return;
    }

    // Wait for session to be fully ready (not just loading to be false)
    if (!sessionReady) return;

    // Resolve role from multiple sources (profile > user_metadata > email hint)
    const resolvedRole = 
      profile?.role?.toLowerCase() || 
      (user?.user_metadata?.role ? String(user.user_metadata.role).toLowerCase() : null) ||
      ((user?.email || '').toLowerCase().includes('admin') ? 'admin' : null);

    // If user is authenticated, redirect to their dashboard
    if (user) {
      if (resolvedRole === 'admin') {
        router.replace('/admin-dashboard');
      } else if (resolvedRole === 'expert') {
        router.replace('/expert-dashboard');
      } else {
        // Unknown role or farmer - go to login
        router.replace('/login');
      }
    } else {
      // No active session - go to login
      router.replace('/login');
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