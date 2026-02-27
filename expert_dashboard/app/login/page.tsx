"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, Suspense } from "react";
import { supabase } from "@/components/supabase";
import toast from "react-hot-toast";
import { Mail, Lock, Eye, EyeOff, CheckCircle } from "lucide-react";
import { mapSupabaseAuthError, validateEmail } from "@/utils/authErrors";
import { useUser } from "@/components/UserContext";
import { getUserAccessProfile, ACCESS_ERRORS } from "@/lib/roleAccess";

function LoginPageContent() {
  const router = useRouter();
  const { user, profile, loading: userLoading, sessionReady } = useUser();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<'error' | 'pending'>('error');
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);
  // State to show "redirecting" UI - set to true right before navigation
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [redirectTarget, setRedirectTarget] = useState<string | null>(null);
  const sessionHandled = useRef(false);
  const loginInProgress = useRef(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ensure component is mounted on client to avoid hydration issues
  useEffect(() => {
    setMounted(true);
    
    // Cleanup timeout on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Track if redirect has been initiated to prevent infinite loops
  const redirectInitiated = useRef(false);

  // BULLETPROOF REDIRECT FUNCTION
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
      const dashboardName = targetRoute.includes('admin') ? 'Admin' : 'Expert';
      toast.success(
        `Login successful! Redirecting to ${dashboardName} Dashboard...`,
        { duration: 3000, icon: '✅' }
      );
    }
    
    // Use Next.js router for SPA navigation
    router.push(targetRoute);
  };

  // Handle redirect for existing session on page load
  // Auto-detect role and redirect to appropriate dashboard
  useEffect(() => {
    // Skip if login is in progress
    if (loginInProgress.current) return;
    // Skip if redirect was already initiated
    if (redirectInitiated.current) return;
    // Wait for UserContext to finish loading
    if (userLoading || !sessionReady) {
      redirectInitiated.current = false;
      return;
    }

    // Reset flags when no user
    if (!user) {
      sessionHandled.current = false;
      redirectInitiated.current = false;
      return;
    }

    // Already handled this session
    if (sessionHandled.current) return;

    // User exists with profile - check access
    if (user && profile) {
      sessionHandled.current = true;
      
      // Block farmers
      if (profile.role === 'farmer') {
        setError(ACCESS_ERRORS.FARMER_DENIED);
        toast.error(ACCESS_ERRORS.FARMER_DENIED);
        supabase.auth.signOut().catch(() => {});
        return;
      }

      // Check expert approval status
      if (profile.role === 'expert' && profile.status !== 'approved') {
        const statusMsg = profile.status === 'rejected' 
          ? ACCESS_ERRORS.EXPERT_REJECTED 
          : ACCESS_ERRORS.EXPERT_NOT_APPROVED;
        setErrorType('pending');
        setError(statusMsg);
        toast(statusMsg, {
          duration: 5000,
          icon: 'ℹ️',
          style: { background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE' },
        });
        supabase.auth.signOut().catch(() => {});
        return;
      }

      // Clear timeout since redirect is happening
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      // Route based on role - admin goes to admin-dashboard, expert goes to expert-dashboard
      const targetRoute = profile.role === 'admin' ? '/admin-dashboard' : '/expert-dashboard';
      performRedirect(targetRoute, false);
    }

    // Fallback: user exists but no profile yet - wait for profile to load
    if (user && !profile && sessionReady) {
      // Give it a moment for profile to load
      timeoutRef.current = setTimeout(() => {
        if (!profile && user) {
          // Still no profile after timeout - user might be admin with RLS issues
          // Check user metadata as fallback
          const metaRole = user.user_metadata?.role;
          if (metaRole === 'admin') {
            performRedirect('/admin-dashboard', false);
          }
        }
      }, 2000);
    }
  }, [user, profile, userLoading, sessionReady]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevent multiple submissions
    if (loading || loginInProgress.current || isRedirecting) {
      return;
    }
    
    setError(null);
    setErrorType('error');
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

      // STEP 1: Sign in with Supabase
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

      // STEP 2: Get user access profile (role + status) using centralized helper
      const accessProfile = await getUserAccessProfile(supabase, data.user.id);

      console.log('[Login] Access profile:', accessProfile);

      // STEP 3: Check if user can access dashboard
      if (!accessProfile.canAccessDashboard) {
        console.log('[Login] Access denied:', accessProfile.errorMessage);
        
        // Set appropriate error type for pending vs other errors
        if (accessProfile.role === 'expert' && accessProfile.status === 'pending') {
          setErrorType('pending');
        }
        
        setError(accessProfile.errorMessage || ACCESS_ERRORS.ROLE_MISMATCH);
        
        // Show toast with appropriate style
        if (accessProfile.role === 'expert' && accessProfile.status !== 'approved') {
          toast(accessProfile.errorMessage || ACCESS_ERRORS.EXPERT_NOT_APPROVED, {
            duration: 5000,
            icon: 'ℹ️',
            style: { background: '#EFF6FF', color: '#1E40AF', border: '1px solid #BFDBFE' },
          });
        } else {
          toast.error(accessProfile.errorMessage || ACCESS_ERRORS.FARMER_DENIED);
        }
        
        // Sign out the user
        await supabase.auth.signOut();
        setLoading(false);
        loginInProgress.current = false;
        return;
      }

      // STEP 4: SUCCESS! Redirect to appropriate dashboard
      console.log('[Login] All validations passed! Redirecting to:', accessProfile.dashboardRoute);
      
      const dashboardRoute = accessProfile.dashboardRoute!;
      
      // Show success state
      setIsRedirecting(true);
      setRedirectTarget(dashboardRoute);
      setLoading(false);
      loginInProgress.current = false;
      
      // Show toast
      const dashboardName = accessProfile.role === 'admin' ? 'Admin' : 'Expert';
      toast.success(`Login successful! Redirecting to ${dashboardName} Dashboard...`, {
        duration: 3000,
        icon: '✅'
      });

      // Use Next.js SPA navigation
      console.log('[Login] === REDIRECTING NOW TO:', dashboardRoute, '===');
      redirectInitiated.current = true;
      router.push(dashboardRoute);
      
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
          <h1 className="text-4xl font-bold text-gray-900 mb-6">Welcome to BitterScan</h1>
          <h2 className="text-xl font-medium text-gray-700 mb-8">
            Sign in to your account
          </h2>
          <p className="text-gray-600 text-lg leading-relaxed text-justify">
            Access your dashboard to validate and manage content with precision and efficiency.
            Your role will be automatically detected upon login.
          </p>
        </div>
      </div>

      {/* Right side - Login Form Card */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile Welcome Text */}
          <div className="lg:hidden mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome to BitterScan</h1>
            <h2 className="text-lg font-medium text-gray-700 mb-6">
              Sign in to your account
            </h2>
            <p className="text-gray-600 text-base leading-relaxed text-justify mb-8">
              Access your dashboard to validate and manage content.
              Your role will be automatically detected upon login.
            </p>
          </div>

          {/* Form Card */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg p-8">
            {/* Header */}
            <div className="mb-6 text-center">
              <h3 className="text-xl font-semibold text-gray-900 mb-2">Sign In</h3>
              <p className="text-sm text-gray-600">Enter your credentials to continue</p>
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
                    <CheckCircle className="h-5 w-5 text-white" />
                    <span>Login Successful!</span>
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
                  <CheckCircle className="h-6 w-6 text-green-600" />
                  <div>
                    <p className="text-sm font-semibold text-green-800">Login Successful!</p>
                    <p className="text-xs text-green-600">Redirecting to {redirectTarget?.includes('admin') ? 'Admin' : 'Expert'} Dashboard...</p>
                  </div>
                </div>
              )}
            </form>

            {error && (
              <div className={`mt-6 p-4 rounded-lg ${
                errorType === 'pending'
                  ? 'bg-blue-50 border border-blue-200'
                  : 'bg-red-50 border border-red-200'
              }`}>
                <p className={`text-sm ${
                  errorType === 'pending' ? 'text-blue-700' : 'text-red-600'
                }`}>{error}</p>
              </div>
            )}

            {/* Info Notice */}
            {!error && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800 leading-relaxed">
                  <span className="font-semibold">Note:</span> New expert accounts require admin approval before you can access the dashboard.
                  Farmer accounts are only available on the mobile app.
                </p>
              </div>
            )}

            <div className="mt-8 text-center">
              <p className="text-sm text-gray-600">
                Don&apos;t have an expert account?{" "}
                <Link
                  href="/register"
                  className="text-[#388E3C] hover:text-[#2F7A33] font-medium hover:underline transition-colors"
                >
                  Create Account
                </Link>
              </p>
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
