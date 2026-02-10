"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import DashboardContent from "@/components/DashboardContent";
import { useUser } from "@/components/UserContext";
import { Loader2 } from "lucide-react";

export default function ExpertDashboardPage() {
  const router = useRouter();
  const { profile, loading, sessionReady } = useUser();
  const [showContent, setShowContent] = useState(false);

  // Master timeout: Show content after 5s even if session isn't ready
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!sessionReady) {
        console.warn('[ExpertDashboard] Session ready timeout - proceeding anyway');
        setShowContent(true);
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [sessionReady]);

  // Set showContent when sessionReady becomes true
  useEffect(() => {
    if (sessionReady) {
      setShowContent(true);
    }
  }, [sessionReady]);

  useEffect(() => {
    // Wait for session to be fully ready before making routing decisions
    if (loading || !sessionReady) return;
    if (!profile) return;
    if (profile.role !== "expert") {
      // Non-experts should be rerouted away from expert dashboard
      router.replace(profile.role === "admin" ? "/admin-dashboard" : "/role-select");
    }
  }, [loading, sessionReady, profile, router]);

  // Show loading state until session is ready or timeout
  if (!showContent) {
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
