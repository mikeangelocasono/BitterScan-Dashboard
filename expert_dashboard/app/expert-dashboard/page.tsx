"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import DashboardContent from "@/components/DashboardContent";
import { useUser } from "@/components/UserContext";
import { Loader2 } from "lucide-react";

export default function ExpertDashboardPage() {
  const router = useRouter();
  const { user, profile, loading, sessionReady } = useUser();

  // Resolve role from multiple sources
  const resolvedRole = 
    profile?.role?.toLowerCase() || 
    (user?.user_metadata?.role ? String(user.user_metadata.role).toLowerCase() : null) ||
    ((user?.email || '').toLowerCase().includes('admin') ? 'admin' : null);

  useEffect(() => {
    // Wait for session to be fully ready before making routing decisions
    if (loading || !sessionReady) return;
    if (!user) return;
    if (resolvedRole !== "expert") {
      // Non-experts should be rerouted away from expert dashboard
      router.replace(resolvedRole === "admin" ? "/admin-dashboard" : "/login");
    }
  }, [loading, sessionReady, user, resolvedRole, router]);

  // Show brief loading only during initial session resolution
  // Once sessionReady is true (set immediately by UserContext), render DashboardContent
  // which manages its own loading skeleton for data fetching
  if (!sessionReady) {
    return (
      <AuthGuard>
        <AppShell>
          <div className="flex items-center justify-center min-h-[60vh]">
            <div className="text-center">
              <Loader2 className="h-10 w-10 animate-spin text-[#388E3C] mx-auto mb-4" />
              <p className="text-gray-600 text-sm">Loading dashboard...</p>
            </div>
          </div>
        </AppShell>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <AppShell>
        <DashboardContent />
      </AppShell>
    </AuthGuard>
  );
}
