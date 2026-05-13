"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Camera, AlertCircle, CheckCircle2, Clock3, ShieldCheck, UserCheck, FileText, BarChart3, Eye, Activity, TrendingUp } from "lucide-react";
import Image from "next/image";
import { useUser } from "@/components/UserContext";
import { useData } from "@/components/DataContext";
import { formatDate, formatScanType, getStatusColor } from "@/utils/dateUtils";
import { getAiPrediction, isNonAmpalayaScan, type Scan } from "@/types";
import EmptyState from "@/components/ui/EmptyState";

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
  const { scans, totalUsers, validationHistory, loading: dataLoading, error } = useData();
  const guardNotifiedRef = useRef(false);
  const [forceRender, setForceRender] = useState(false);

  const effectiveRole = useMemo(() => profile?.role || user?.user_metadata?.role || null, [profile?.role, user?.user_metadata?.role]);
  const adminEmailHint = useMemo(() => (user?.email || '').toLowerCase().includes('admin'), [user?.email]);
  const isAdmin = useMemo(() => effectiveRole === "admin" || adminEmailHint, [effectiveRole, adminEmailHint]);

  // Prevent infinite loading: if loading persists after 1s, force render
  useEffect(() => {
    const timeout = setTimeout(() => {
      if ((userLoading || dataLoading) && !forceRender) {
        console.warn('[AdminDashboard] Loading timeout - forcing render');
        setForceRender(true);
      }
    }, 1000);
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
      if (aiResult === "Unknown") return false;
      if (isNonAmpalayaScan(scan)) return false;
      return true;
    });
  }, [scans]);

  const stats = useMemo(() => {
    if (!validScans || validScans.length === 0) {
      return { total: 0, pending: 0, confirmed: 0, corrections: 0 };
    }
    const total = validScans.length;

    // Pending = scans still awaiting expert review (from scan table status)
    const pending = validScans.filter((s) => {
      const status = (s.status || '').toLowerCase().trim();
      return status.includes('pending') || status.includes('awaiting');
    }).length;

    // For confirmed vs corrections, use validationHistory but only count entries
    // that correspond to scans in our validScans set
    // Build a Set of all valid scan identifiers (scan_uuid and string id)
    const validScanIds = new Set<string>();
    validScans.forEach(s => {
      if (s.scan_uuid) validScanIds.add(String(s.scan_uuid).trim());
      if (s.id) validScanIds.add(String(s.id).trim());
    });

    let confirmed = 0;
    let corrections = 0;

    if (validationHistory && validationHistory.length > 0) {
      validationHistory.forEach((v) => {
        // Match by scan_id (could be UUID or numeric ID)
        const scanId = String(v.scan_id ?? '').trim();
        if (!scanId || !validScanIds.has(scanId)) return;

        const status = (v.status || '').toLowerCase().trim();
        if (status === 'corrected') {
          corrections++;
        } else if (status === 'validated' || status === 'confirmed') {
          confirmed++;
        }
      });
    }

    return { total, pending, confirmed, corrections };
  }, [validScans, validationHistory]);

  // Latest 5 validations sorted by date descending
  const latestValidations = useMemo(() => {
    if (!validationHistory || validationHistory.length === 0) return [];
    return [...validationHistory]
      .sort((a, b) => {
        const da = a.validated_at ? new Date(a.validated_at).getTime() : 0;
        const db = b.validated_at ? new Date(b.validated_at).getTime() : 0;
        return db - da;
      })
      .slice(0, 5);
  }, [validationHistory]);


  // Show loading only during initial session resolution
  const hasData = scans && scans.length >= 0;
  if (!forceRender && !sessionReady && (userLoading || (dataLoading && !hasData))) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-gray-200 rounded w-52" />
          <div className="h-4 bg-gray-100 rounded w-40" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 space-y-3">
                <div className="h-4 bg-gray-200 rounded w-24" />
                <div className="h-8 bg-gray-200 rounded w-16" />
              </div>
            ))}
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
            <div className="h-6 bg-gray-200 rounded w-32" />
            {[1, 2, 3].map(i => (<div key={i} className="h-12 bg-gray-100 rounded" />))}
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
            <Button onClick={() => router.replace("/login")}>Login</Button>
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
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
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
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mb-1">Admin Dashboard</h1>
          <p className="text-gray-500 text-xs sm:text-sm">Monitor platform activity, manage users, and track system performance</p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
        {[{
          label: "Total Scans",
          value: stats.total,
          icon: Camera,
          tone: "text-blue-600",
          bgTone: "bg-blue-50",
        }, {
          label: "Pending Validation",
          value: stats.pending,
          icon: Clock3,
          tone: "text-amber-600",
          bgTone: "bg-amber-50",
        }, {
          label: "Confirmed Validations",
          value: stats.confirmed,
          icon: CheckCircle2,
          tone: "text-emerald-600",
          bgTone: "bg-emerald-50",
        }, {
          label: "Corrections",
          value: stats.corrections,
          icon: AlertCircle,
          tone: "text-purple-600",
          bgTone: "bg-purple-50",
        }].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center justify-between gap-3 hover:shadow-md transition-all duration-200 min-h-[88px] overflow-hidden">
              <div className="min-w-0">
                <p className="text-xs font-medium text-gray-500 mb-1">{card.label}</p>
                <p className="text-xl font-bold text-gray-900">{card.value.toLocaleString()}</p>
              </div>
              <div className={`h-9 w-9 rounded-lg ${card.bgTone} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`h-4 w-4 ${card.tone}`} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Validation Status + Latest System Activity (single row on large screens) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      {/* Validation Status Overview */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
        <div className="px-5 sm:px-6 py-4 bg-gradient-to-r from-[#388E3C] to-[#2F7A33]">
          <h3 className="text-base font-bold !text-white">Validation Status Overview</h3>
          <p className="text-xs !text-white/80 mt-0.5">Monitor scan review progress and expert validation activity.</p>
        </div>
        <div className="p-5 sm:p-6 flex-1">
          {stats.total === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <BarChart3 className="h-10 w-10 text-gray-300 mb-3" />
              <h3 className="text-sm font-semibold text-gray-700 mb-1">No validation data yet</h3>
              <p className="text-xs text-gray-400 max-w-xs">
                Scan validation data will appear here once experts begin reviewing submissions.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-6 lg:gap-8 items-center">
              {/* Left: Donut Chart */}
              <div className="flex flex-col items-center justify-center">
                <div className="relative">
                  <svg viewBox="0 0 160 160" className="w-44 h-44 sm:w-52 sm:h-52">
                    {/* Background track */}
                    <circle cx="80" cy="80" r="70" fill="none" stroke="#f3f4f6" strokeWidth="20" />
                    {/* Pending segment */}
                    <circle
                      cx="80" cy="80" r="70" fill="none"
                      stroke="#F59E0B" strokeWidth="20"
                      strokeDasharray={`${(stats.pending / stats.total) * 439.82} 439.82`}
                      strokeDashoffset="0"
                      strokeLinecap="round"
                      transform="rotate(-90 80 80)"
                      className="transition-all duration-700"
                    />
                    {/* Confirmed segment */}
                    <circle
                      cx="80" cy="80" r="70" fill="none"
                      stroke="#10B981" strokeWidth="20"
                      strokeDasharray={`${(stats.confirmed / stats.total) * 439.82} 439.82`}
                      strokeDashoffset={`-${(stats.pending / stats.total) * 439.82}`}
                      strokeLinecap="round"
                      transform="rotate(-90 80 80)"
                      className="transition-all duration-700"
                    />
                    {/* Corrections segment */}
                    <circle
                      cx="80" cy="80" r="70" fill="none"
                      stroke="#8B5CF6" strokeWidth="20"
                      strokeDasharray={`${(stats.corrections / stats.total) * 439.82} 439.82`}
                      strokeDashoffset={`-${((stats.pending + stats.confirmed) / stats.total) * 439.82}`}
                      strokeLinecap="round"
                      transform="rotate(-90 80 80)"
                      className="transition-all duration-700"
                    />
                  </svg>
                  {/* Center label */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-xl font-bold text-gray-900">{stats.total.toLocaleString()}</span>
                    <span className="text-[10px] text-gray-500 uppercase tracking-wider">Total Scans</span>
                  </div>
                </div>
              </div>

              {/* Right: Breakdown */}
              <div className="space-y-4">
                {[
                  { label: 'Pending Validation', value: stats.pending, color: 'bg-amber-500', textColor: 'text-amber-600', lightBg: 'bg-amber-50' },
                  { label: 'Confirmed Validations', value: stats.confirmed, color: 'bg-emerald-500', textColor: 'text-emerald-600', lightBg: 'bg-emerald-50' },
                  { label: 'Corrections', value: stats.corrections, color: 'bg-violet-500', textColor: 'text-violet-600', lightBg: 'bg-violet-50' },
                ].map((item) => {
                  const pct = stats.total > 0 ? Math.round((item.value / stats.total) * 100) : 0;
                  return (
                    <div key={item.label} className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${item.color} flex-shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-gray-700">{item.label}</span>
                          <span className="text-sm font-bold text-gray-900">{item.value.toLocaleString()}</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                          <div className={`${item.color} h-2 rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className={`text-xs font-semibold ${item.textColor} w-10 text-right`}>{pct}%</span>
                    </div>
                  );
                })}

                {/* Validation Rate */}
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-[#E6F3E7] flex items-center justify-center">
                        <TrendingUp className="h-4 w-4 text-[#388E3C]" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">Validation Rate</p>
                        <p className="text-[10px] text-gray-400">
                          {stats.confirmed + stats.corrections} of {stats.total} scans reviewed
                        </p>
                      </div>
                    </div>
                    <span className="text-xl font-bold text-[#388E3C]">
                      {stats.total > 0 ? Math.round(((stats.confirmed + stats.corrections) / stats.total) * 100) : 0}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Latest System Activity */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
        <div className="px-5 sm:px-6 py-4 bg-gradient-to-r from-[#388E3C] to-[#2F7A33]">
          <h3 className="text-base font-bold !text-white">Latest System Activity</h3>
          <p className="text-xs !text-white/80 mt-0.5">Recent platform events and user interactions.</p>
        </div>
        <div className="p-0 flex-1">
          {latestValidations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <Activity className="h-10 w-10 text-gray-300 mb-3" />
              <h3 className="text-sm font-semibold text-gray-700 mb-1">No recent system activity yet</h3>
              <p className="text-xs text-gray-400 max-w-xs">
                Platform activities will appear here once users interact with the system.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {latestValidations.map((activity) => (
                <div key={activity.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50/50 transition-colors">
                  <div className={`mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center flex-shrink-0 ${activity.status === 'Validated' ? 'bg-emerald-50' : 'bg-blue-50'}`}>
                    {activity.status === 'Validated' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-blue-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {activity.expert_name || 'Unknown Expert'} {activity.status === 'Validated' ? 'validated' : 'corrected'} a scan
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 truncate">
                      AI detected: {activity.ai_prediction}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${activity.status === 'Validated' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                      {activity.status}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {activity.validated_at ? formatDate(activity.validated_at) : 'N/A'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
