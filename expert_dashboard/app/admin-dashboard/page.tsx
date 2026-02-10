"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Camera, AlertCircle, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { useUser } from "@/components/UserContext";
import { useData } from "@/components/DataContext";
import { formatDate, formatScanType, getStatusColor } from "@/utils/dateUtils";
import { getAiPrediction, type Scan } from "@/types";

export default function AdminDashboardPage() {
  return (
    <AuthGuard>
      <AppShell>
        <AdminDashboardContent />
      </AppShell>
    </AuthGuard>
  );
}

function AdminDashboardContent() {
  const router = useRouter();
  const { user, profile, loading: userLoading, sessionReady } = useUser();
  const { scans, loading: dataLoading, error } = useData();
  const guardNotifiedRef = useRef(false);
  const [forceRender, setForceRender] = useState(false);

  const effectiveRole = useMemo(() => profile?.role || user?.user_metadata?.role || null, [profile?.role, user?.user_metadata?.role]);
  const adminEmailHint = useMemo(() => (user?.email || '').toLowerCase().includes('admin'), [user?.email]);
  const isAdmin = useMemo(() => effectiveRole === "admin" || adminEmailHint, [effectiveRole, adminEmailHint]);

  // Prevent infinite loading: if loading persists after 4s, force render
  // This handles edge cases where DataContext might not clear loading properly
  useEffect(() => {
    const timeout = setTimeout(() => {
      if ((userLoading || dataLoading) && !forceRender) {
        console.warn('[AdminDashboard] Loading timeout - forcing render');
        setForceRender(true);
      }
    }, 4000);
    return () => clearTimeout(timeout);
  }, [userLoading, dataLoading, forceRender]);

  useEffect(() => {
    if (userLoading) return;
    if (!isAdmin && !guardNotifiedRef.current) {
      guardNotifiedRef.current = true;
      router.replace("/dashboard");
    }
  }, [isAdmin, router, userLoading]);

  const validScans = useMemo(() => {
    if (!scans || scans.length === 0) return [] as Scan[];
    return scans.filter((scan) => {
      const status = (scan.status as string) || "";
      if (status === "Unknown") return false;
      const aiResult = getAiPrediction(scan);
      return aiResult !== "Unknown";
    });
  }, [scans]);

  const stats = useMemo(() => {
    if (!validScans || validScans.length === 0) {
      return { total: 0, pending: 0, validated: 0, corrected: 0 };
    }
    const total = validScans.length;
    const pending = validScans.filter((s) => s.status === "Pending" || s.status === "Pending Validation").length;
    const validated = validScans.filter((s) => s.status === "Validated").length;
    const corrected = validScans.filter((s) => s.status === "Corrected").length;
    return { total, pending, validated, corrected };
  }, [validScans]);

  const recentScans = useMemo(() => {
    return [...validScans]
      .sort((a, b) => {
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 5);
  }, [validScans]);

  // Show loading only during initial session resolution
  // Once sessionReady is true OR we have data OR forceRender, render the dashboard
  const hasData = scans && scans.length >= 0; // scans array exists
  if (!forceRender && !sessionReady && (userLoading || (dataLoading && !hasData))) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--background)] py-24">
        <div className="text-center space-y-3">
          <div className="relative">
            <div className="h-12 w-12 border-4 border-[#388E3C]/20 border-t-[#388E3C] rounded-full animate-spin mx-auto" />
          </div>
          <div>
            <p className="text-gray-900 font-medium">Loading Dashboard</p>
            <p className="text-sm text-gray-500 mt-1">Fetching admin data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--background)]">
        <div className="text-center space-y-3">
          <ShieldCheck className="h-10 w-10 text-amber-500 mx-auto" />
          <h2 className="text-xl font-semibold text-gray-900">Admin access required</h2>
          <p className="text-gray-600">You do not have permission to view this page.</p>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => router.replace("/dashboard")}>Go to dashboard</Button>
            <Button onClick={() => router.replace("/role-select")}>Login</Button>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const isConfigError = error.toLowerCase().includes('supabase') || error.toLowerCase().includes('configuration') || error.toLowerCase().includes('environment');
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--background)]">
        <div className="text-center space-y-4 max-w-md px-4">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
          <h2 className="text-xl font-semibold text-gray-900">Dashboard Error</h2>
          <p className="text-red-600 font-medium text-sm">{error}</p>
          {isConfigError && (
            <p className="text-gray-500 text-xs">
              Ensure SUPABASE_SERVICE_ROLE_KEY is set in your Vercel environment variables and redeploy.
            </p>
          )}
          <div className="flex justify-center gap-2 pt-2">
            <Button variant="outline" onClick={() => window.location.reload()}>Retry</Button>
            <Button onClick={() => router.replace("/dashboard")}>Go to dashboard</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-1">Admin Dashboard</h1>
          <p className="text-gray-600 text-sm">Monitor platform activity and recent scans</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
        {[{
          label: "Total Scans",
          value: stats.total,
          icon: Camera,
          tone: "text-blue-600",
          bgTone: "bg-blue-50"
        }, {
          label: "Pending Validation",
          value: stats.pending,
          icon: Clock3,
          tone: "text-amber-600",
          bgTone: "bg-amber-50"
        }, {
          label: "Validated",
          value: stats.validated,
          icon: CheckCircle2,
          tone: "text-emerald-600",
          bgTone: "bg-emerald-50"
        }, {
          label: "Corrected",
          value: stats.corrected,
          icon: AlertCircle,
          tone: "text-purple-600",
          bgTone: "bg-purple-50"
        }].map((card) => (
          <Card key={card.label} className="shadow-sm hover:shadow-md transition-all duration-200">
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">{card.label}</span>
                <div className={`p-1.5 rounded-lg ${card.bgTone}`}>
                  <card.icon className={`h-4 w-4 ${card.tone}`} />
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-2xl font-bold text-gray-900">{card.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-sm border border-gray-200 hover:shadow-md transition-all duration-200 bg-white rounded-lg overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 border-b rounded-t-xl">
          <CardTitle className="text-lg font-bold" style={{ color: 'white' }}>Recent Scans</CardTitle>
          <p className="text-sm mt-1" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Latest scan submissions and their validation status</p>
        </CardHeader>
        <CardContent className="p-0">
          {recentScans.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500 font-medium text-sm">No scans available yet</p>
                <p className="text-gray-400 text-xs mt-1">Recent scans will appear here</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full">
                <Thead>
                  <Tr className="bg-gray-50 border-b-2 border-gray-200">
                    <Th className="whitespace-nowrap text-xs font-semibold text-gray-700 uppercase tracking-wider">Farmer</Th>
                    <Th className="whitespace-nowrap text-xs font-semibold text-gray-700 uppercase tracking-wider">Scan Type</Th>
                    <Th className="whitespace-nowrap text-xs font-semibold text-gray-700 uppercase tracking-wider">AI Prediction</Th>
                    <Th className="whitespace-nowrap text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</Th>
                    <Th className="whitespace-nowrap text-xs font-semibold text-gray-700 uppercase tracking-wider">Date & Time</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {recentScans.map((scan) => {
                    const key = scan.scan_uuid || `${scan.scan_type}-${scan.id}`;
                    return (
                      <Tr key={key} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <Td className="whitespace-nowrap py-4 px-6">
                          <div className="flex items-center gap-3">
                            {scan.farmer_profile?.profile_picture ? (
                              <Image
                                src={scan.farmer_profile.profile_picture}
                                alt="Profile"
                                width={36}
                                height={36}
                                className="w-9 h-9 rounded-full object-cover ring-2 ring-gray-100"
                                loading="lazy"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-sm font-semibold text-white ring-2 ring-gray-100">
                                {scan.farmer_profile?.full_name?.charAt(0) || scan.farmer_profile?.username?.charAt(0) || "?"}
                              </div>
                            )}
                            <div className="font-medium text-sm text-gray-900">
                              {scan.farmer_profile?.full_name || scan.farmer_profile?.username || "Unknown Farmer"}
                            </div>
                          </div>
                        </Td>
                        <Td className="py-4 px-6 text-sm text-gray-700 font-medium">{scan.scan_type ? formatScanType(scan.scan_type) : "N/A"}</Td>
                        <Td className="py-4 px-6 max-w-xs truncate text-sm text-gray-700">{getAiPrediction(scan) || "N/A"}</Td>
                        <Td className="py-4 px-6">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${getStatusColor(scan.status)}`}>
                            {scan.status}
                          </span>
                        </Td>
                        <Td className="py-4 px-6 whitespace-nowrap text-sm text-gray-500">
                          {scan.created_at ? formatDate(scan.created_at) : "N/A"}
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
