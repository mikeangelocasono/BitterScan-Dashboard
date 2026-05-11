"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import toast from "react-hot-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, UserCheck, Loader2, Filter, AlertCircle, Search, X, ArrowUpDown, Users, ShieldCheck, Calendar, ArrowDownAZ, ArrowDownZA } from "lucide-react";
import Pagination from "@/components/ui/pagination";
import { useUser } from "@/components/UserContext";
import { formatDate } from "@/utils/dateUtils";
import Badge from "@/components/ui/badge";
import type { UserProfile } from "@/types";
import { supabase } from "@/components/supabase";
import { useNotifications } from "@/components/NotificationContext";

// Cache keys
const CACHE_KEY_PENDING = 'bs:cache:pending-users';
const CACHE_KEY_APPROVED = 'bs:cache:approved-users';
const CACHE_KEY_REJECTED = 'bs:cache:rejected-users';
const CACHE_EXPIRY_MS = 2 * 60 * 1000; // 2 min cache

// Pagination constants
const PAGE_SIZE = 5;

function loadCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;
    const { data, ts } = JSON.parse(item);
    if (Date.now() - ts < CACHE_EXPIRY_MS) return data as T;
    return data as T; // Still return stale for instant display
  } catch { return null; }
}

function saveCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

export default function AdminApprovalsPage() {
  return (
    <AuthGuard>
      <AppShell>
        <ApprovalsContent />
      </AppShell>
    </AuthGuard>
  );
}

function ApprovalsContent() {
  const router = useRouter();
  const { user, profile, loading: userLoading, sessionReady } = useUser();
  const { markUsersAsRead } = useNotifications();
  
  // Initialize from cache for instant display
  const [pendingUsers, setPendingUsers] = useState<UserProfile[]>(() => loadCache<UserProfile[]>(CACHE_KEY_PENDING) || []);
  const [approvedUsers, setApprovedUsers] = useState<UserProfile[]>(() => loadCache<UserProfile[]>(CACHE_KEY_APPROVED) || []);
  const [rejectedUsers, setRejectedUsers] = useState<UserProfile[]>(() => loadCache<UserProfile[]>(CACHE_KEY_REJECTED) || []);
  
  // Only show loading if no cached data
  const hasCachedData = (loadCache<UserProfile[]>(CACHE_KEY_PENDING)?.length || 0) > 0 ||
                        (loadCache<UserProfile[]>(CACHE_KEY_APPROVED)?.length || 0) > 0 ||
                        (loadCache<UserProfile[]>(CACHE_KEY_REJECTED)?.length || 0) > 0;
  const [loading, setLoading] = useState(!hasCachedData);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<"all" | "expert" | "farmer">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [sortOption, setSortOption] = useState<"newest" | "oldest" | "name-asc" | "name-desc">("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const guardNotifiedRef = useRef(false);
  const isFetchingRef = useRef(false);
  const hasCachedDataRef = useRef(hasCachedData);

  const effectiveRole = useMemo(() => profile?.role || user?.user_metadata?.role || null, [profile?.role, user?.user_metadata?.role]);
  const adminEmailHint = useMemo(() => (user?.email || '').toLowerCase().includes('admin'), [user?.email]);
  const isAdmin = useMemo(() => effectiveRole === "admin" || adminEmailHint, [effectiveRole, adminEmailHint]);

  // Auto-mark pending users as read when this page is visited so the
  // notification bell badge clears for items the admin is already looking at.
  useEffect(() => {
    if (pendingUsers.length > 0) {
      markUsersAsRead(pendingUsers.map((u) => u.id));
    }
  }, [pendingUsers, markUsersAsRead]);

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) return;
    if (isFetchingRef.current) return; // Prevent duplicate calls
    
    isFetchingRef.current = true;
    // Only show loading spinner if no cached data exists (use ref to avoid deps issue)
    if (!hasCachedDataRef.current) setLoading(true);
    try {
      // Get current session token
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) {
        toast.error('Authentication required. Please log in again.');
        if (typeof window !== 'undefined') window.location.href = '/login';
        return;
      }
      
      const res = await fetch("/api/users", { 
        cache: "no-store",
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        const rawMessage = typeof body?.error === "string" && body.error.trim()
          ? body.error
          : `Failed to fetch user list (${res.status})`;
        const msgLower = rawMessage.toLowerCase();
        
        // Check for auth errors
        if (res.status === 401 || res.status === 403) {
          toast.error('Session expired. Please log in again.');
          if (typeof window !== 'undefined') window.location.href = '/login';
          return;
        }
        
        const isRecursion = msgLower.includes("infinite recursion") || msgLower.includes("recursion");
        const isMissingCreds = msgLower.includes("missing supabase") || msgLower.includes("missing environment") || msgLower.includes("server configuration");
        const userMessage = isRecursion
          ? "Profiles policy blocked (recursion). Please review RLS."
          : isMissingCreds
          ? "Server configuration error. Please ensure SUPABASE_SERVICE_ROLE_KEY is set in Vercel environment variables."
          : rawMessage;
        toast.error(userMessage);
        setPendingUsers([]);
        setApprovedUsers([]);
        setRejectedUsers([]);
        return;
      }

      const { profiles = [] } = body as { profiles: UserProfile[] };
      const pending = profiles.filter((u) => u.status === "pending");
      const approved = profiles.filter((u) => u.status === "approved");
      const rejected = profiles.filter((u) => u.status === "rejected");
      
      setPendingUsers(pending);
      setApprovedUsers(approved);
      setRejectedUsers(rejected);
      
      // Save to cache for instant display on next visit
      saveCache(CACHE_KEY_PENDING, pending);
      saveCache(CACHE_KEY_APPROVED, approved);
      saveCache(CACHE_KEY_REJECTED, rejected);
      hasCachedDataRef.current = true; // Mark that we have data
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : "Failed to fetch user list";
      const msgLower = rawMessage.toLowerCase();
      const isRecursion = msgLower.includes("infinite recursion") || msgLower.includes("recursion");
      toast.error(isRecursion ? "Profiles policy blocked (recursion). Please review RLS." : rawMessage);
      setPendingUsers([]);
      setApprovedUsers([]);
      setRejectedUsers([]);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  }, [isAdmin]);

  // Fetch users immediately when admin status is confirmed (don't wait for full session resolution)
  useEffect(() => {
    // If admin is confirmed, start fetching immediately
    if (isAdmin && user?.id) {
      fetchUsers();
      return;
    }
    // Wait for session to be ready before redirecting non-admins
    if (!sessionReady) return;
    if (!isAdmin) {
      if (!guardNotifiedRef.current) {
        guardNotifiedRef.current = true;
        toast.error("Admin access only.");
      }
      router.replace("/dashboard");
    }
  }, [sessionReady, isAdmin, user?.id, fetchUsers, router]);

  // Master timeout to prevent infinite loading
  useEffect(() => {
    if (!loading) return;
    const timeout = setTimeout(() => {
      if (loading) {
        console.warn('[ApprovalsPage] Master timeout - clearing loading state');
        setLoading(false);
      }
    }, 2000); // 2 second timeout for fast UX
    return () => clearTimeout(timeout);
  }, [loading]);

  const approveUser = async (userId: string) => {
    if (!isAdmin) return;
    if (processingId) return; // Prevent multiple simultaneous operations
    
    setProcessingId(userId);
    try {
      // Get current session token
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) {
        toast.error('Authentication required. Please log in again.');
        if (typeof window !== 'undefined') window.location.href = '/login';
        return;
      }
      
      const res = await fetch("/api/users/approve", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });

      const body = await res.json();

      if (!res.ok) {
        // Check for auth errors
        if (res.status === 401 || res.status === 403) {
          toast.error('Session expired. Please log in again.');
          if (typeof window !== 'undefined') window.location.href = '/login';
          return;
        }
        
        const errorMsg = body?.error || body?.message || "Failed to approve user";
        throw new Error(errorMsg);
      }

      toast.success(body?.message || "User approved successfully");
      await fetchUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to approve user";
      toast.error(message);
    } finally {
      setProcessingId(null);
    }
  };

  const rejectUser = async (userId: string) => {
    if (!isAdmin) return;
    if (processingId) return; // Prevent multiple simultaneous operations
    
    setProcessingId(userId);
    try {
      // Get current session token
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      
      if (!token) {
        toast.error('Authentication required. Please log in again.');
        if (typeof window !== 'undefined') window.location.href = '/login';
        return;
      }
      
      const res = await fetch("/api/users/reject", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ userId }),
      });

      const body = await res.json();

      if (!res.ok) {
        // Check for auth errors
        if (res.status === 401 || res.status === 403) {
          toast.error('Session expired. Please log in again.');
          if (typeof window !== 'undefined') window.location.href = '/login';
          return;
        }
        
        const errorMsg = body?.error || body?.message || "Failed to reject user";
        throw new Error(errorMsg);
      }

      toast.success(body?.message || "User rejected");
      await fetchUsers();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to reject user";
      toast.error(message);
    } finally {
      setProcessingId(null);
    }
  };

  // Unified search + role filter + sort
  const filterAndSort = useCallback((users: UserProfile[]) => {
    let filtered = [...users];
    // Role filter
    if (roleFilter !== "all") {
      filtered = filtered.filter((u) => u.role === roleFilter);
    }
    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((u) =>
        (u.full_name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        (u.username || "").toLowerCase().includes(q)
      );
    }
    // Sort
    filtered.sort((a, b) => {
      if (sortOption === "newest") {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      }
      if (sortOption === "oldest") {
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      }
      const nameA = (a.full_name || a.username || "").toLowerCase();
      const nameB = (b.full_name || b.username || "").toLowerCase();
      if (sortOption === "name-asc") return nameA.localeCompare(nameB);
      if (sortOption === "name-desc") return nameB.localeCompare(nameA);
      return 0;
    });
    return filtered;
  }, [roleFilter, searchQuery, sortOption]);

  const filteredPending = useMemo(() => filterAndSort(pendingUsers), [filterAndSort, pendingUsers]);
  const filteredApproved = useMemo(() => filterAndSort(approvedUsers), [filterAndSort, approvedUsers]);
  const filteredRejected = useMemo(() => filterAndSort(rejectedUsers), [filterAndSort, rejectedUsers]);

  // Pagination state for each table
  const [currentPagePending, setCurrentPagePending] = useState(1);
  const [currentPageApproved, setCurrentPageApproved] = useState(1);
  const [currentPageRejected, setCurrentPageRejected] = useState(1);

  // Reset to page 1 when filter or data changes
  useEffect(() => {
    setCurrentPagePending(1);
  }, [roleFilter, statusFilter, searchQuery, sortOption, pendingUsers.length]);

  useEffect(() => {
    setCurrentPageApproved(1);
  }, [roleFilter, statusFilter, searchQuery, sortOption, approvedUsers.length]);

  useEffect(() => {
    setCurrentPageRejected(1);
  }, [roleFilter, statusFilter, searchQuery, sortOption, rejectedUsers.length]);

  // Paginated records for each table
  const displayedPending = useMemo(() => {
    const startIndex = (currentPagePending - 1) * PAGE_SIZE;
    return filteredPending.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredPending, currentPagePending]);

  const displayedApproved = useMemo(() => {
    const startIndex = (currentPageApproved - 1) * PAGE_SIZE;
    return filteredApproved.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredApproved, currentPageApproved]);

  const displayedRejected = useMemo(() => {
    const startIndex = (currentPageRejected - 1) * PAGE_SIZE;
    return filteredRejected.slice(startIndex, startIndex + PAGE_SIZE);
  }, [filteredRejected, currentPageRejected]);

  // Only show full-page loading during initial session resolution
  if (!sessionReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--background)]">
        <div className="text-center space-y-3">
          <Loader2 className="h-12 w-12 animate-spin text-[#388E3C] mx-auto" />
          <div>
            <p className="text-gray-900 font-medium">Loading...</p>
            <p className="text-sm text-gray-500 mt-1">Checking permissions...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--background)]">
        <div className="text-center space-y-3">
          <UserCheck className="h-10 w-10 text-emerald-600 mx-auto" />
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

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mb-1">Account Approval</h1>
        <p className="text-gray-500 text-sm">Review, approve, reject, and manage user registration requests.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-5">
        {[{
          title: "Pending Approvals",
          value: pendingUsers.length,
          icon: AlertCircle,
          iconColor: "text-amber-600",
          bgColor: "bg-amber-50",
        }, {
          title: "Approved Users",
          value: approvedUsers.length,
          icon: CheckCircle2,
          iconColor: "text-emerald-600",
          bgColor: "bg-emerald-50",
        }, {
          title: "Rejected Users",
          value: rejectedUsers.length,
          icon: XCircle,
          iconColor: "text-red-600",
          bgColor: "bg-red-50",
        }].map(card => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="shadow-sm hover:shadow-md transition-all duration-200 border border-gray-100">
              <CardHeader className="pb-1 pt-4 px-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{card.title}</span>
                  <div className={`${card.bgColor} p-2 rounded-lg`}>
                    <Icon className={`h-4 w-4 ${card.iconColor}`} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pb-4 pt-1 px-5">
                <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Control Bar */}
      <Card className="shadow-sm border border-gray-200 bg-white rounded-xl overflow-hidden">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, or username..."
                className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#388E3C]/20 focus:border-[#388E3C] transition-all placeholder:text-gray-400"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Role Filter */}
            <div className="flex items-center gap-2 min-w-[140px]">
              <Filter className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as typeof roleFilter)}
                className="flex-1 text-sm border border-gray-200 rounded-lg bg-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#388E3C]/20 focus:border-[#388E3C] transition-all cursor-pointer"
              >
                <option value="all">All Roles</option>
                <option value="expert">Experts</option>
                <option value="farmer">Farmers</option>
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-2 min-w-[140px]">
              <ShieldCheck className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="flex-1 text-sm border border-gray-200 rounded-lg bg-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#388E3C]/20 focus:border-[#388E3C] transition-all cursor-pointer"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            {/* Sort */}
            <div className="flex items-center gap-2 min-w-[150px]">
              <ArrowUpDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as typeof sortOption)}
                className="flex-1 text-sm border border-gray-200 rounded-lg bg-white px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#388E3C]/20 focus:border-[#388E3C] transition-all cursor-pointer"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="name-asc">Name A-Z</option>
                <option value="name-desc">Name Z-A</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending Approvals */}
      {(statusFilter === "all" || statusFilter === "pending") && (
        <Card className="shadow-sm border border-gray-200 bg-white rounded-xl overflow-hidden">
          <CardHeader className="px-6 py-5 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] rounded-t-xl">
            <CardTitle className="text-lg font-bold" style={{ color: '#ffffff' }}>Pending Approvals <span className="ml-2 text-sm font-normal opacity-80">({filteredPending.length})</span></CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {filteredPending.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-6 bg-gray-50/50">
                <Users className="h-8 w-8 text-gray-300 mb-2" />
                <p className="text-sm font-medium text-gray-500">No pending approvals</p>
                <p className="text-xs text-gray-400 mt-0.5">New user registrations will appear here.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table className="w-full">
                    <Thead>
                      <Tr className="bg-gray-50/80 border-b border-gray-200">
                        <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">User</Th>
                        <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</Th>
                        <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Role</Th>
                        <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Registered</Th>
                        <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</Th>
                        <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {displayedPending.map((user) => (
                        <Tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50/70 transition-colors">
                          <Td className="whitespace-nowrap py-3.5 px-6">
                            <span className="font-medium text-sm text-gray-900">{user.full_name || user.username || "Unknown User"}</span>
                          </Td>
                          <Td className="py-3.5 px-6 text-sm text-gray-600">{user.email || "N/A"}</Td>
                          <Td className="py-3.5 px-6">
                            <Badge color={user.role === "expert" ? "blue" : "amber"}>{user.role || "Unknown"}</Badge>
                          </Td>
                          <Td className="py-3.5 px-6 whitespace-nowrap text-xs text-gray-500">{user.created_at ? formatDate(user.created_at) : "N/A"}</Td>
                          <Td className="py-3.5 px-6">
                            <Badge color="amber">Pending</Badge>
                          </Td>
                          <Td className="py-3.5 px-6">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => approveUser(user.id)}
                                disabled={processingId === user.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {processingId === user.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                Approve
                              </button>
                              <button
                                onClick={() => rejectUser(user.id)}
                                disabled={processingId === user.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {processingId === user.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                                Reject
                              </button>
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </div>
                <div className="px-6 py-4 border-t border-gray-100">
                  <Pagination
                    currentPage={currentPagePending}
                    totalRecords={filteredPending.length}
                    pageSize={PAGE_SIZE}
                    onPageChange={setCurrentPagePending}
                    showInfo={true}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Approved & Rejected — Side by Side */}
      {(statusFilter === "all" || statusFilter === "approved" || statusFilter === "rejected") && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Approved Users */}
          {(statusFilter === "all" || statusFilter === "approved") && (
            <Card className="shadow-sm border border-gray-200 bg-white rounded-xl overflow-hidden flex flex-col">
              <CardHeader className="px-6 py-5 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] rounded-t-xl">
                <CardTitle className="text-lg font-bold" style={{ color: '#ffffff' }}>Approved Users <span className="ml-2 text-sm font-normal opacity-80">({filteredApproved.length})</span></CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1">
                {filteredApproved.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-6 bg-gray-50/50">
                    <Users className="h-8 w-8 text-gray-300 mb-2" />
                    <p className="text-sm font-medium text-gray-500">{searchQuery ? "No matching approved users" : "No approved users yet"}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{searchQuery ? "Try adjusting your search or filters" : "Approved users will appear here."}</p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table className="w-full">
                        <Thead>
                          <Tr className="bg-gray-50/80 border-b border-gray-200">
                            <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">User</Th>
                            <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</Th>
                            <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Role</Th>
                            <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</Th>
                            <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {displayedApproved.map((user) => (
                            <Tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50/70 transition-colors">
                              <Td className="whitespace-nowrap py-3.5 px-6">
                                <span className="font-medium text-sm text-gray-900">{user.full_name || user.username || "Unknown User"}</span>
                              </Td>
                              <Td className="py-3.5 px-6 text-sm text-gray-600">{user.email || "N/A"}</Td>
                              <Td className="py-3.5 px-6">
                                <Badge color={user.role === "expert" ? "blue" : "amber"}>{user.role || "Unknown"}</Badge>
                              </Td>
                              <Td className="py-3.5 px-6 whitespace-nowrap text-xs text-gray-500">{user.updated_at ? formatDate(user.updated_at) : "N/A"}</Td>
                              <Td className="py-3.5 px-6">
                                <Badge color="green">Approved</Badge>
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </div>
                    <div className="px-6 py-4 border-t border-gray-100">
                      <Pagination
                        currentPage={currentPageApproved}
                        totalRecords={filteredApproved.length}
                        pageSize={PAGE_SIZE}
                        onPageChange={setCurrentPageApproved}
                        showInfo={true}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Rejected Users */}
          {(statusFilter === "all" || statusFilter === "rejected") && (
            <Card className="shadow-sm border border-gray-200 bg-white rounded-xl overflow-hidden flex flex-col">
              <CardHeader className="px-6 py-5 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] rounded-t-xl">
                <CardTitle className="text-lg font-bold" style={{ color: '#ffffff' }}>Rejected Users <span className="ml-2 text-sm font-normal opacity-80">({filteredRejected.length})</span></CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1">
                {filteredRejected.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 px-6 bg-gray-50/50">
                    <Users className="h-8 w-8 text-gray-300 mb-2" />
                    <p className="text-sm font-medium text-gray-500">{searchQuery ? "No matching rejected users" : "No rejected users"}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{searchQuery ? "Try adjusting your search or filters" : "Rejected users will appear here."}</p>
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <Table className="w-full">
                        <Thead>
                          <Tr className="bg-gray-50/80 border-b border-gray-200">
                            <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">User</Th>
                            <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Email</Th>
                            <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Role</Th>
                            <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</Th>
                            <Th className="whitespace-nowrap text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {displayedRejected.map((user) => (
                            <Tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50/70 transition-colors">
                              <Td className="whitespace-nowrap py-3.5 px-6">
                                <span className="font-medium text-sm text-gray-900">{user.full_name || user.username || "Unknown User"}</span>
                              </Td>
                              <Td className="py-3.5 px-6 text-sm text-gray-600">{user.email || "N/A"}</Td>
                              <Td className="py-3.5 px-6">
                                <Badge color={user.role === "expert" ? "blue" : "amber"}>{user.role || "Unknown"}</Badge>
                              </Td>
                              <Td className="py-3.5 px-6 whitespace-nowrap text-xs text-gray-500">{user.updated_at ? formatDate(user.updated_at) : "N/A"}</Td>
                              <Td className="py-3.5 px-6">
                                <Badge color="red">Rejected</Badge>
                              </Td>
                            </Tr>
                          ))}
                        </Tbody>
                      </Table>
                    </div>
                    <div className="px-6 py-4 border-t border-gray-100">
                      <Pagination
                        currentPage={currentPageRejected}
                        totalRecords={filteredRejected.length}
                        pageSize={PAGE_SIZE}
                        onPageChange={setCurrentPageRejected}
                        showInfo={true}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
