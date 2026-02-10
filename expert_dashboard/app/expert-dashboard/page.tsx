"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import DashboardContent from "@/components/DashboardContent";
import { useUser } from "@/components/UserContext";

export default function ExpertDashboardPage() {
  const router = useRouter();
  const { profile, loading } = useUser();

  useEffect(() => {
    if (loading) return;
    if (!profile) return;
    if (profile.role !== "expert") {
      // Non-experts should be rerouted away from expert dashboard
      router.replace(profile.role === "admin" ? "/admin-dashboard" : "/role-select");
    }
  }, [loading, profile, router]);

  return (
    <AuthGuard>
      <AppShell>
        {profile?.role === "expert" ? (
          <DashboardContent />
        ) : (
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
              <p className="text-lg text-gray-600">Unauthorized access</p>
            </div>
          </div>
        )}
      </AppShell>
    </AuthGuard>
  );
}
