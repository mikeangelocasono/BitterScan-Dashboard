"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, Suspense } from "react";
import { supabase } from "@/components/supabase";
import toast from "react-hot-toast";
import { Mail, Lock, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { mapSupabaseAuthError, validateEmail } from "@/utils/authErrors";
import { useUser } from "@/components/UserContext";

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profile, loading: userLoading, sessionReady, refreshProfile } = useUser();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Get role from URL query param - critical for role-based login
  const roleParam = searchParams.get("role");
  const [selectedRole, setSelectedRole] = useState<"admin" | "expert">("expert");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);
  // State to show "redirecting" UI - set to true right before navigation
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [redirectTarget, setRedirectTarget] = useState<string | null>(null);
  const roleMismatchHandled = useRef(false);
  const loginInProgress = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ensure component is mounted on client to avoid hydration issues
  useEffect(() => {
    setMounted(true);
    
    // Set role from URL param if available
    if (roleParam === "admin" || roleParam === "expert") {
      setSelectedRole(roleParam);
    } else if (!roleParam) {
      // If no role param, redirect to role selection page
      router.replace("/role-select");
    }
    
    // Cleanup timeout on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [roleParam, router]);

  // Track if redirect has been initiated to prevent infinite loops
  const redirectInitiated = useRef(false);

  // BULLETPROOF REDIRECT FUNCTION - Uses window.location.href directly
  // This bypasses all React state management issues
  const performRedirect = (targetRoute: string, showNotification: boolean = true) => {
    // Prevent duplicate redirects
    if (redirectInitiated.current) return;
    redirectInitiated.current = true;
    
    console.log('[Login] Performing redirect to:', targetRoute);
    
    // Update UI to show redirecting state
    setIsRedirecting(true);
    setRedirectTarget(targetRoute);
    setLoading(false);
    loginInProgress.current = false;
    
    // Show success notification
    if (showNotification) {
      toast.success(
        `Login successful! Redirecting to ${targetRoute.includes('admin') ? 'Admin' : 'Expert'} Dashboard...`,
        { duration: 3000, icon: '🎉' }
      );
    }
    
    // IMMEDIATE REDIRECT using window.location.href
    // This is the most reliable method as it performs a full page navigation
    // Small delay to allow toast to be visible
    setTimeout(() => {
      if (typeof window !== 'undefined') {
        window.location.href = targetRoute;
      }
    }, 100);
  };

  // Handle redirect for existing session on page load
  // This catches cases where user refreshes the page while logged in
  useEffect(() => {
    // Skip if login is in progress - let onSubmit handle the redirect
    if (loginInProgress.current) {
      return;
    }

    // Skip if redirect was already initiated (prevents double redirects)
    if (redirectInitiated.current) {
      return;
    }

    // Wait for UserContext to finish loading and resolve session
    if (userLoading || !sessionReady) {
      redirectInitiated.current = false;
      return;
    }

    // Reset flags when no user (prevents stale state)
    if (!user) {
      roleMismatchHandled.current = false;
      redirectInitiated.current = false;
      return;
    }

    // RBAC: Check if user status is approved before allowing access
    if (user && profile && profile.status !== 'approved' && profile.role !== 'admin' && !roleMismatchHandled.current) {
      roleMismatchHandled.current = true;
      loginInProgress.current = false;
      redirectInitiated.current = false;
      setLoading(false);
      const statusMsg = "Your account is pending approval. Please wait for an administrator to review your registration.";
      setError(statusMsg);
      toast.error(statusMsg);
      supabase.auth.signOut().catch(() => {
        // ignore sign-out errors; listener keeps state consistent
      });
      return;
    }

    // RBAC: Block farmer accounts from web access
    if (user && profile && profile.role === 'farmer' && !roleMismatchHandled.current) {
      roleMismatchHandled.current = true;
      loginInProgress.current = false;
      redirectInitiated.current = false;
      setLoading(false);
      const farmerMsg = "This account is intended for the mobile application only. Web dashboard access is not available for farmer accounts.";
      setError(farmerMsg);
      toast.error(farmerMsg);
      supabase.auth.signOut().catch(() => {
        // ignore sign-out errors; listener keeps state consistent
      });
      return;
    }

    // RBAC: Check if existing session role matches selected role
    // If there's a role mismatch, sign out the user and show error
    if (user && profile && !roleMismatchHandled.current && !redirectInitiated.current) {
      // Check if the logged-in user's role matches the selected role
      if (profile.role !== selectedRole) {
        roleMismatchHandled.current = true;
        loginInProgress.current = false;
        setLoading(false);
        
        let mismatchMsg = '';
        if (selectedRole === 'expert') {
          if (profile.role === 'admin') {
            mismatchMsg = 'You are currently logged in with an Admin account. This page is for Expert accounts only. Please log out first or use the Admin login page.';
          } else if (profile.role === 'farmer') {
            mismatchMsg = 'You are currently logged in with a Farmer account. This page is for Expert accounts only. Please log out first.';
          }
        } else if (selectedRole === 'admin') {
          if (profile.role === 'expert') {
            mismatchMsg = 'You are currently logged in with an Expert account. This page is for Admin accounts only. Please log out first or use the Expert login page.';
          } else if (profile.role === 'farmer') {
            mismatchMsg = 'You are currently logged in with a Farmer account. This page is for Admin accounts only. Please log out first.';
          }
        }
        
        setError(mismatchMsg);
        toast.error(mismatchMsg, { duration: 6000 });
        
        // Sign out the user to prevent auto-login with wrong role
        supabase.auth.signOut().catch(() => {
          // ignore sign-out errors
        });
        return;
      }
      
      // Role matches - proceed with redirect
      if (profile.status === 'approved' || profile.role === 'admin') {
        // Clear timeout since redirect is happening
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        
        // Direct redirect using bulletproof function
        const targetRoute = profile.role === 'admin' ? '/admin-dashboard' : '/expert-dashboard';
        performRedirect(targetRoute, false);
      }
    }

    // Fallback: if admin profile cannot be read but user is authenticated as admin, allow redirect
    if (user && !profile && sessionReady && selectedRole === 'admin' && !redirectInitiated.current) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Direct redirect using bulletproof function
      performRedirect('/admin-dashboard', false);
    }
  }, [user, profile, userLoading, sessionReady, selectedRole]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevent multiple submissions
    if (loading || loginInProgress.current || isRedirecting) {
      return;
    }
    
    setError(null);
    setLoading(true);
    loginInProgress.current = true;

    // Basic validation
    if (!email || !password) {
      toast.error("All fields are required");
      setError("All fields are required");
      setLoading(false);
      loginInProgress.current = false;
      return;
    }

    if (!validateEmail(email)) {
      toast.error("Invalid email format");
      setError("Invalid email format");
      setLoading(false);
      loginInProgress.current = false;
      return;
    }

    try {
      console.log('[Login] Starting sign in process...');

      // STEP 1: Sign in with Supabase - SIMPLE, no timeout race
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      console.log('[Login] Sign in result:', { hasData: !!data, hasError: !!signInError });

      // Handle sign in error
      if (signInError) {
        console.error('[Login] Sign in error:', signInError.message);
        const userMessage = mapSupabaseAuthError(signInError.message || 'Invalid credentials');
        setError(userMessage);
        toast.error(userMessage);
        setLoading(false);
        loginInProgress.current = false;
        return;
      }

      // Verify user exists
      if (!data?.user) {
        console.error('[Login] No user data returned');
        setError("Login failed. Please try again.");
        toast.error("Login failed. Please try again.");
        setLoading(false);
        loginInProgress.current = false;
        return;
      }

      console.log('[Login] Sign in successful! User ID:', data.user.id);

      // STEP 2: Fetch profile to get role
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('role, status')
        .eq('id', data.user.id)
        .single();

      console.log('[Login] Profile fetch result:', { profileData, profileError: profileError?.message });

      // Determine role (use profile if available, otherwise use selectedRole)
      let userRole = profileData?.role || selectedRole;
      let userStatus = profileData?.status || (selectedRole === 'admin' ? 'approved' : 'pending');

      // If admin and no profile, create one
      if (!profileData && selectedRole === 'admin') {
        console.log('[Login] Creating admin profile...');
        await supabase.from('profiles').upsert({
          id: data.user.id,
          email: data.user.email || '',
          full_name: data.user.user_metadata?.full_name || 'Admin',
          username: (data.user.email || '').split('@')[0] || 'admin',
          role: 'admin',
          status: 'approved',
        });
        userRole = 'admin';
        userStatus = 'approved';
      }

      // If expert and no profile, create one
      if (!profileData && selectedRole === 'expert') {
        console.log('[Login] Creating expert profile...');
        await supabase.from('profiles').upsert({
          id: data.user.id,
          email: data.user.email || '',
          full_name: data.user.user_metadata?.full_name || 'Expert',
          username: (data.user.email || '').split('@')[0] || 'expert',
          role: 'expert',
          status: 'pending',
        });
        userRole = 'expert';
        userStatus = 'pending';
      }

      console.log('[Login] User role:', userRole, 'Status:', userStatus);

      // STEP 3: Validate role matches selected role
      if (userRole !== selectedRole) {
        const roleMsg = selectedRole === 'admin' 
          ? 'This account is not an Admin account. Please use the Expert login.'
          : 'This account is not an Expert account. Please use the Admin login.';
        setError(roleMsg);
        toast.error(roleMsg);
        await supabase.auth.signOut();
        setLoading(false);
        loginInProgress.current = false;
        return;
      }

      // STEP 4: Check approval status (experts only)
      if (userRole === 'expert' && userStatus !== 'approved') {
        const statusMsg = 'Your account is pending approval. Please wait for an administrator to approve your account.';
        setError(statusMsg);
        toast.error(statusMsg);
        await supabase.auth.signOut();
        setLoading(false);
        loginInProgress.current = false;
        return;
      }

      // STEP 5: SUCCESS! Redirect immediately
      console.log('[Login] All validations passed! Redirecting...');
      
      const dashboardRoute = userRole === 'admin' ? '/admin-dashboard' : '/expert-dashboard';
      
      // Show success state
      setIsRedirecting(true);
      setRedirectTarget(dashboardRoute);
      setLoading(false);
      loginInProgress.current = false;
      
      // Show toast
      toast.success(`Login successful! Redirecting to ${userRole === 'admin' ? 'Admin' : 'Expert'} Dashboard...`, {
        duration: 3000,
        icon: '🎉'
      });

      // FORCE REDIRECT - This WILL work
      console.log('[Login] === REDIRECTING NOW TO:', dashboardRoute, '===');
      
      // Use window.location.href immediately
      window.location.href = dashboardRoute;
      
    } catch (err: unknown) {
      console.error('[Login] Unexpected error:', err);
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(errorMessage);
      toast.error(errorMessage);
      setLoading(false);
      loginInProgress.current = false;
    }
  };


  // Prevent hydration mismatch by not rendering form until mounted
  if (!mounted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 border-4 border-[#388E3C] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left side - Welcome Text */}
      <div className="hidden lg:flex lg:w-1/2 items-center justify-center p-16">
        <div className="max-w-lg">
          <h1 className="text-4xl font-bold text-gray-900 mb-6">Welcome Back</h1>
          <h2 className="text-xl font-medium text-gray-700 mb-8">
            {selectedRole === 'admin' ? 'Sign in to your Admin account' : 'Sign in to your Expert account'}
          </h2>
          <p className="text-gray-600 text-lg leading-relaxed text-justify">
            {selectedRole === 'admin'
              ? 'Access administrative tools and manage the system securely.'
              : 'Access your Expert dashboard to validate and manage content with precision and efficiency.'}
          </p>
        </div>
      </div>

      {/* Right side - Login Form Card */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile Welcome Text */}
          <div className="lg:hidden mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome Back</h1>
            <h2 className="text-lg font-medium text-gray-700 mb-6">
              {selectedRole === 'admin' ? 'Sign in to your Admin account' : 'Sign in to your Expert account'}
            </h2>
            <p className="text-gray-600 text-base leading-relaxed text-justify mb-8">
              {selectedRole === 'admin'
                ? 'Access administrative tools and manage the system securely.'
                : 'Access your Expert dashboard to validate and manage content with precision and efficiency.'}
            </p>
          </div>

          {/* Form Card */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg p-8">
            {/* Back to Role Selection */}
            <Link 
              href="/role-select" 
              className="inline-flex items-center text-sm text-gray-600 hover:text-[#388E3C] transition-colors mb-6 group"
            >
              <ArrowLeft className="h-4 w-4 mr-1 group-hover:-translate-x-1 transition-transform" />
              Change Role
            </Link>

            {/* Role Display Badge */}
            <div className="mb-6">
              <div className="inline-flex items-center px-4 py-2 rounded-lg" style={{ backgroundColor: '#E6F3E7', borderColor: '#A7D3AA', border: '1px solid' }}>
                <span className="text-sm text-gray-600 mr-2">Logging in as:</span>
                <span className="text-sm font-semibold text-[#388E3C] capitalize">{selectedRole}</span>
              </div>
            </div>

            <form onSubmit={onSubmit} className="space-y-6">{/* Email Field */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <input 
                    type="email" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    required 
                    autoComplete="email"
                    className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-all duration-200 bg-gray-50 focus:bg-white text-gray-900" 
                    placeholder="Enter your email"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <input 
                    type={showPassword ? "text" : "password"} 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    required 
                    autoComplete="current-password"
                    className="w-full pl-10 pr-12 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-all duration-200 bg-gray-50 focus:bg-white text-gray-900" 
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              {/* Submit Button */}
              <button 
                type="submit" 
                disabled={loading || loginInProgress.current || isRedirecting} 
                className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white font-medium hover:from-[#2F7A33] hover:to-[#388E3C] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center justify-center gap-2"
              >
                {isRedirecting ? (
                  <>
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Redirecting to Dashboard...</span>
                  </>
                ) : (loading || loginInProgress.current) ? (
                  <>
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Signing In...</span>
                  </>
                ) : (
                  "Sign In"
                )}
              </button>

              {/* Redirect notification */}
              {isRedirecting && (
                <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
                  <div className="h-6 w-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                  <div>
                    <p className="text-sm font-semibold text-green-800">Login Successful!</p>
                    <p className="text-xs text-green-600">Redirecting to {redirectTarget?.includes('admin') ? 'Admin' : 'Expert'} Dashboard...</p>
                  </div>
                </div>
              )}
            </form>

            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Expert Approval Notice */}
            {selectedRole === 'expert' && !error && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800 leading-relaxed">
                  <span className="font-semibold">Note:</span> New expert accounts require admin approval before you can access the dashboard.
                </p>
              </div>
            )}

            <div className="mt-8 text-center">{selectedRole === 'admin' ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm text-gray-700 leading-relaxed">
                    <span className="font-semibold text-gray-900">Admin accounts are created by the MAGRO Head Expert.</span>
                    <br />
                    Contact your administrator to request access.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-gray-600">
                  Don&apos;t have an account?{" "}
                  <Link
                    href="/register"
                    className="text-[#388E3C] hover:text-[#2F7A33] font-medium hover:underline transition-colors"
                  >
                    Create Account
                  </Link>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 border-4 border-[#388E3C] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600 text-sm">Loading...</p>
        </div>
      </div>
    }>
      <LoginPageContent />
    </Suspense>
  );
}
