"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import toast from "react-hot-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, UserCheck, Loader2, Filter, AlertCircle } from "lucide-react";
import { useUser } from "@/components/UserContext";
import { formatDate } from "@/utils/dateUtils";
import Badge from "@/components/ui/badge";
import type { UserProfile } from "@/types";
import { supabase } from "@/components/supabase";

// Cache keys
const CACHE_KEY_PENDING = 'bs:cache:pending-users';
const CACHE_KEY_APPROVED = 'bs:cache:approved-users';
const CACHE_KEY_REJECTED = 'bs:cache:rejected-users';
const CACHE_EXPIRY_MS = 2 * 60 * 1000; // 2 min cache

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
  const guardNotifiedRef = useRef(false);
  const isFetchingRef = useRef(false);
  const hasCachedDataRef = useRef(hasCachedData);

  const effectiveRole = useMemo(() => profile?.role || user?.user_metadata?.role || null, [profile?.role, user?.user_metadata?.role]);
  const adminEmailHint = useMemo(() => (user?.email || '').toLowerCase().includes('admin'), [user?.email]);
  const isAdmin = useMemo(() => effectiveRole === "admin" || adminEmailHint, [effectiveRole, adminEmailHint]);

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

  const filteredPending = useMemo(() => {
    if (roleFilter === "all") return pendingUsers;
    return pendingUsers.filter((user) => user.role === roleFilter);
  }, [pendingUsers, roleFilter]);

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
            <Button onClick={() => router.replace("/role-select")}>Login</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-1">Account Approval</h1>
            <p className="text-gray-600 text-sm">Review and approve new experts or farmers.</p>
          </div>
          {loading && <Loader2 className="h-5 w-5 animate-spin text-[#388E3C]" />}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-6">
        {[{
          title: "Pending Approvals",
          value: pendingUsers.length,
          icon: AlertCircle,
          iconColor: "text-amber-600",
          bgColor: "bg-amber-50"
        }, {
          title: "Approved Users",
          value: approvedUsers.length,
          icon: CheckCircle2,
          iconColor: "text-emerald-600",
          bgColor: "bg-emerald-50"
        }, {
          title: "Rejected Users",
          value: rejectedUsers.length,
          icon: XCircle,
          iconColor: "text-red-600",
          bgColor: "bg-red-50"
        }].map(card => {
          const Icon = card.icon;
          return (
            <Card key={card.title} className="shadow-sm hover:shadow-md transition-all duration-200">
              <CardHeader className="pb-2 pt-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-gray-700">{card.title}</CardTitle>
                  <div className={`${card.bgColor} p-2 rounded-lg`}>
                    <Icon className={`h-5 w-5 ${card.iconColor}`} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pb-4">
                <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-white shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 rounded-xl overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>Pending Approvals ({pendingUsers.length})</CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-sm text-white/90 font-medium">Filter:</span>
            <div className="flex gap-2 bg-white/10 rounded-lg p-1">
              {[{ label: "All", value: "all" }, { label: "Experts", value: "expert" }, { label: "Farmers", value: "farmer" }].map(option => (
                <button
                  key={option.value}
                  onClick={() => setRoleFilter(option.value as typeof roleFilter)}
                  className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all duration-200 ${
                    roleFilter === option.value 
                      ? "bg-white text-[#388E3C] shadow-sm" 
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 px-6 pb-6">
          {filteredPending.length === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50">
              <p className="font-medium text-gray-500">No pending approvals</p>
              <p className="mt-1 text-xs text-gray-400">New user registrations will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="rounded-lg border border-gray-200 shadow-sm">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Username</Th>
                    <Th>Role</Th>
                    <Th>Registered</Th>
                    <Th>Actions</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {filteredPending.map((user) => (
                    <Tr key={user.id}>
                      <Td>{user.full_name}</Td>
                      <Td>{user.email}</Td>
                      <Td>{user.username}</Td>
                      <Td>
                        <Badge color={user.role === "expert" ? "blue" : "amber"}>{user.role}</Badge>
                      </Td>
                      <Td>{user.created_at ? formatDate(user.created_at) : "N/A"}</Td>
                      <Td>
                        <div className="flex gap-2">
                          <button
                            onClick={() => approveUser(user.id)}
                            disabled={processingId === user.id}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 hover:shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                          >
                            {processingId === user.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4" />
                            )}
                            Approve
                          </button>
                          <button
                            onClick={() => rejectUser(user.id)}
                            disabled={processingId === user.id}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 bg-gradient-to-r from-red-500 to-red-600 text-white hover:from-red-600 hover:to-red-700 hover:shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                          >
                            {processingId === user.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <XCircle className="h-4 w-4" />
                            )}
                            Reject
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 rounded-xl overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
          <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>Approved Users ({approvedUsers.length})</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 px-6 pb-6">
          {approvedUsers.length === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50">
              <p className="font-medium text-gray-500">No approved users yet</p>
              <p className="mt-1 text-xs text-gray-400">Approved users will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="rounded-lg border border-gray-200 shadow-sm">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Username</Th>
                    <Th>Role</Th>
                    <Th>Approved</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {approvedUsers.map((user) => (
                    <Tr key={user.id}>
                      <Td>{user.full_name}</Td>
                      <Td>{user.email}</Td>
                      <Td>{user.username}</Td>
                      <Td>
                        <Badge color={user.role === "expert" ? "blue" : "amber"}>{user.role}</Badge>
                      </Td>
                      <Td>{user.updated_at ? formatDate(user.updated_at) : "N/A"}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 rounded-xl overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5">
          <CardTitle className="text-xl font-bold text-white" style={{ color: 'white' }}>Rejected Users ({rejectedUsers.length})</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 px-6 pb-6">
          {rejectedUsers.length === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50">
              <p className="font-medium text-gray-500">No rejected users</p>
              <p className="mt-1 text-xs text-gray-400">Rejected users will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="rounded-lg border border-gray-200 shadow-sm">
                <Thead>
                  <Tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Username</Th>
                    <Th>Role</Th>
                    <Th>Rejected</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {rejectedUsers.map((user) => (
                    <Tr key={user.id}>
                      <Td>{user.full_name}</Td>
                      <Td>{user.email}</Td>
                      <Td>{user.username}</Td>
                      <Td>
                        <Badge color={user.role === "expert" ? "blue" : "amber"}>{user.role}</Badge>
                      </Td>
                      <Td>{user.updated_at ? formatDate(user.updated_at) : "N/A"}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
