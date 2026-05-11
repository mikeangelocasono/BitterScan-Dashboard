"use client";

import { useMemo, memo, useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { Camera, CheckCircle2, AlertCircle, Clock, Info, ClipboardCheck } from "lucide-react";
import { Button } from "./ui/button";
import { useUser } from "./UserContext";
import { useData } from "./DataContext";
import { getAiPrediction, isNonAmpalayaScan, type Scan } from "../types";
import { formatDate, formatScanType, getStatusColor } from "../utils/dateUtils";
import Link from "next/link";

// Memoized loading skeleton component
const LoadingSkeleton = memo(() => (
  <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
    <div className="animate-pulse space-y-6">
      <div className="h-8 bg-gray-200 rounded w-64" />
      <div className="h-4 bg-gray-100 rounded w-48" />
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
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-100 rounded" />
          ))}
        </div>
      </div>
    </div>
  </div>
));
LoadingSkeleton.displayName = "LoadingSkeleton";

// Memoized error component
const ErrorDisplay = memo(({ error }: { error: string }) => (
  <div className="min-h-[60vh] flex items-center justify-center">
    <div className="text-center space-y-4 max-w-md px-4">
      <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto">
        <AlertCircle className="h-8 w-8 text-red-500" />
      </div>
      <h2 className="text-lg font-semibold text-gray-900">Failed to Load Dashboard</h2>
      <p className="text-red-600 text-sm">{error}</p>
      <Button variant="outline" onClick={() => window.location.reload()} className="mt-2">
        Retry
      </Button>
    </div>
  </div>
));
ErrorDisplay.displayName = "ErrorDisplay";

// Memoized stat card component
const StatCard = memo(({
  icon: Icon,
  label,
  value,
  iconColor,
  iconBg,
  index
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  iconColor: string;
  iconBg: string;
  index: number;
}) => (
  <motion.div
    initial={{ y: 12, opacity: 0 }}
    animate={{ y: 0, opacity: 1 }}
    transition={{ delay: index * 0.05, duration: 0.3 }}
  >
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center justify-between hover:shadow-md transition-all duration-200 min-h-[88px]">
      <div>
        <p className="text-xs font-medium text-gray-500 mb-1 whitespace-nowrap">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value.toLocaleString("en-US")}</p>
      </div>
      <div className={`h-8 w-8 rounded-lg ${iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
    </div>
  </motion.div>
));
StatCard.displayName = "StatCard";

// Tab types
type TabKey = "all" | "pending" | "validated" | "corrected";

function DashboardContent() {
  const { user, profile, loading: userLoading, sessionReady } = useUser();
  const { scans, totalUsers, loading: dataLoading, error } = useData();
  const [forceRender, setForceRender] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [scanTypeFilter, setScanTypeFilter] = useState("all");
  const [sortField, setSortField] = useState<"date" | "status" | "type">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Master timeout: force render after 1 second to prevent infinite loading
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!forceRender) {
        console.warn('[DashboardContent] Forcing render after timeout');
        setForceRender(true);
      }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [forceRender]);

  // Show loading state only during initial session resolution
  // Once sessionReady=true OR we have scans data OR forceRender, render dashboard
  // which manages its own loading skeleton for data fetching
  const hasData = scans && scans.length >= 0; // scans array exists (even if empty)
  const isLoading = !forceRender && !sessionReady && (userLoading || (dataLoading && !hasData));

  // Memoize computed values
  const displayName = useMemo(() => {
    return profile?.full_name || user?.user_metadata?.full_name || "Expert";
  }, [profile?.full_name, user?.user_metadata?.full_name]);

  const userRole = useMemo(() => {
    return profile?.role || user?.user_metadata?.role || "Expert";
  }, [profile?.role, user?.user_metadata?.role]);

  // Filter out Unknown scans from all metrics and display
  const validScans = useMemo(() => {
    if (!scans || scans.length === 0) return [];
    
    return scans.filter(scan => {
      if ((scan.status as string) === 'Unknown') return false;
      const result = getAiPrediction(scan);
      if (result === 'Unknown') return false;
      // Exclude Non-Ampalaya scans from all dashboard metrics
      if (isNonAmpalayaScan(scan)) return false;
      return true;
    });
  }, [scans]);

  const { totalScans, validatedScans, pendingValidations, correctedScans, diseaseRecords, ripenessRecords } = useMemo(() => {
    if (!validScans || validScans.length === 0) {
      return { 
        totalScans: 0, 
        validatedScans: 0, 
        pendingValidations: 0, 
        correctedScans: 0,
        diseaseRecords: 0,
        ripenessRecords: 0,
      };
    }
    
    const total = validScans.length;
    const pending = validScans.filter(scan => {
      return scan.status === 'Pending' || scan.status === 'Pending Validation';
    }).length;
    const validated = validScans.filter(scan => scan.status === 'Validated').length;
    const corrected = validScans.filter(scan => scan.status === 'Corrected').length;
    const disease = validScans.filter(scan => scan.scan_type === 'leaf_disease').length;
    const ripeness = validScans.filter(scan => scan.scan_type === 'fruit_maturity').length;
    
    return { 
      totalScans: total, 
      validatedScans: validated, 
      pendingValidations: pending, 
      correctedScans: corrected,
      diseaseRecords: disease,
      ripenessRecords: ripeness,
    };
  }, [validScans]);

  // Filtered and sorted scans for the table
  const displayedScans = useMemo(() => {
    let filtered = [...validScans];

    // Tab filter
    if (activeTab === "pending") {
      filtered = filtered.filter(s => s.status === "Pending" || s.status === "Pending Validation");
    } else if (activeTab === "validated") {
      filtered = filtered.filter(s => s.status === "Validated");
    } else if (activeTab === "corrected") {
      filtered = filtered.filter(s => s.status === "Corrected");
    }

    // Scan type filter
    if (scanTypeFilter !== "all") {
      filtered = filtered.filter(s => s.scan_type === scanTypeFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s => {
        const farmer = s.farmer_profile?.full_name || s.farmer_profile?.username || "";
        const prediction = getAiPrediction(s) || "";
        return farmer.toLowerCase().includes(q) || prediction.toLowerCase().includes(q);
      });
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;
      if (sortField === "date") {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        comparison = dateA - dateB;
      } else if (sortField === "status") {
        comparison = (a.status || "").localeCompare(b.status || "");
      } else if (sortField === "type") {
        comparison = (a.scan_type || "").localeCompare(b.scan_type || "");
      }
      return sortDir === "desc" ? -comparison : comparison;
    });

    return filtered.slice(0, 10); // Show top 10
  }, [validScans, activeTab, scanTypeFilter, searchQuery, sortField, sortDir]);

  const toggleSort = useCallback((field: "date" | "status" | "type") => {
    if (sortField === field) {
      setSortDir(d => d === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }, [sortField]);

  // Show loading only briefly during initial session resolution
  // If sessionReady is true, always show content (even with empty data)
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return <ErrorDisplay error={error} />;
  }

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "all", label: "All Scans", count: totalScans },
    { key: "pending", label: "Pending", count: pendingValidations },
    { key: "validated", label: "Confirmed", count: validatedScans },
    { key: "corrected", label: "Corrections", count: correctedScans },
  ];

  return (
    <div className="space-y-6 sm:space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Welcome Section */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mb-1">Welcome back, {displayName}!</h1>
          <p className="text-gray-500 text-xs sm:text-sm">Here&apos;s your {userRole.toLowerCase()} dashboard overview for today.</p>
        </div>
        <Link href="/validate" className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white text-sm font-medium rounded-lg hover:brightness-110 transition-all shadow-sm">
          <ClipboardCheck className="h-4 w-4" />
          Pending Validation
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { icon: Camera, label: "Total Scans", value: totalScans, iconColor: "text-blue-500", iconBg: "bg-blue-50" },
          { icon: Clock, label: "Pending Validation", value: pendingValidations, iconColor: "text-amber-500", iconBg: "bg-amber-50" },
          { icon: CheckCircle2, label: "Confirmed Validations", value: validatedScans, iconColor: "text-emerald-500", iconBg: "bg-emerald-50" },
          { icon: Info, label: "Corrections", value: correctedScans, iconColor: "text-purple-500", iconBg: "bg-purple-50" }
        ].map((s, idx) => (
          <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} iconColor={s.iconColor} iconBg={s.iconBg} index={idx} />
        ))}
      </div>

      {/* Recent Scans Section */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Green Header */}
        <div className="px-5 sm:px-6 py-4 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold !text-white">Recent Scans</h3>
            <p className="text-xs !text-white/80 mt-0.5">Latest scan submissions and their validation status</p>
          </div>
          <Link
            href="/validate"
            className="text-xs font-medium text-white/90 hover:text-white bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-all duration-200"
          >
            View All →
          </Link>
        </div>

        {/* Table */}
        {displayedScans.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Camera className="h-8 w-8 text-gray-300 mb-2" />
            <p className="text-gray-500 text-sm font-medium">No scans available yet</p>
            <p className="text-gray-400 text-xs mt-0.5">Detection submissions will appear here once farmers submit scans.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Farmer</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Scan Type</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">AI Prediction</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Date & Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {displayedScans.map((scan) => {
                  const uniqueKey = scan.scan_uuid || `${scan.scan_type}-${scan.id}`;
                  return (
                    <tr key={uniqueKey} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="text-sm font-medium text-gray-900">
                          {scan.farmer_profile?.full_name || scan.farmer_profile?.username || 'Unknown Farmer'}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="text-sm text-gray-600">
                          {scan.scan_type ? formatScanType(scan.scan_type) : 'N/A'}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="text-sm text-gray-700">{getAiPrediction(scan) || 'N/A'}</span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${getStatusColor(scan.status)}`}>
                          {scan.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="text-xs text-gray-500">
                          {scan.created_at ? formatDate(scan.created_at) : 'N/A'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(DashboardContent);


