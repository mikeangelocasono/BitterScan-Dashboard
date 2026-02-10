                                                                                                                                                                                                                              "use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import DashboardContent from "@/components/DashboardContent";
import { useUser } from "@/components/UserContext";

// RBAC: Expert-only dashboard - experts can view scan results and validate
// Reports and analytics are admin-only features
export default function DashboardPage() {
  const router = useRouter();
  const { profile } = useUser();

  // Keep backward compatibility: redirect experts to the dedicated dashboard
  useEffect(() => {
    if (!profile) return;
    if (profile.role === "expert") {
      router.replace("/expert-dashboard");
    }
  }, [profile, router]);

  return (
    <AuthGuard>
      <AppShell>
        {/* RBAC: Ensure only expert or admin can access this dashboard */}
        {profile && (profile.role === 'expert' || profile.role === 'admin') ? (
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


