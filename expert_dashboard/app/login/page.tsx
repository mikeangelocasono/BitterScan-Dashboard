"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/components/supabase";
import toast from "react-hot-toast";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { mapSupabaseAuthError, validateEmail } from "@/utils/authErrors";
import { useUser } from "@/components/UserContext";

export default function LoginPage() {
  const router = useRouter();
  const { user, profile, loading: userLoading } = useUser();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);
  const roleMismatchHandled = useRef(false);
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

  // Handle redirect after successful login - wait for user context to update
  useEffect(() => {
    // Don't redirect while user context is loading or login is in progress
    if (userLoading || loginInProgress.current) return;

    // Reset role mismatch flag when user logs out
    if (!user) {
      roleMismatchHandled.current = false;
      loginInProgress.current = false;
      return;
    }

    // Handle role mismatch
    if (user && profile && profile.role !== "expert" && !roleMismatchHandled.current) {
      // Clear timeout since we're handling error
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      roleMismatchHandled.current = true;
      loginInProgress.current = false;
      setLoading(false);
      const roleMsg = "You are not allowed to log in here because your role does not match.";
      setError(roleMsg);
      toast.error(roleMsg);
      supabase.auth.signOut().catch(() => {
        // ignore sign-out errors; listener keeps state consistent
      });
      return;
    }

    // Redirect to dashboard when user is authenticated and has expert role
    if (user && (!profile || profile.role === "expert")) {
      // Clear timeout since redirect is happening
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      loginInProgress.current = false;
      setLoading(false);
      router.replace("/dashboard");
    }
  }, [user, profile, userLoading, router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    loginInProgress.current = true;

    // Validation
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
      // Validate environment variables are available
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        const configError = 'Supabase client is not properly configured. Please check your environment variables.';
        setError(configError);
        toast.error(configError);
        setLoading(false);
        loginInProgress.current = false;
        return;
      }

      // Attempt login with Supabase
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      // Check for Supabase error response
      if (signInError) {
        // Extract error message from Supabase error object
        let errorMessage = signInError.message || '';
        
        // Check for additional error details
        if (signInError.status) {
          // Handle specific HTTP status codes
          if (signInError.status === 400) {
            errorMessage = errorMessage || 'Invalid email or password.';
          } else if (signInError.status === 429) {
            errorMessage = 'Too many login attempts. Please try again later.';
          } else if (signInError.status === 500) {
            errorMessage = 'Server error. Please try again later.';
          }
        }
        
        // Map to user-friendly message
        const userMessage = mapSupabaseAuthError(errorMessage || 'Invalid credentials');
        setError(userMessage);
        toast.error(userMessage);
        setLoading(false);
        loginInProgress.current = false;
        return;
      }

      // Verify user data exists
      if (!data || !data.user) {
        const noUserError = "Login failed. No user data returned.";
        setError(noUserError);
        toast.error(noUserError);
        setLoading(false);
        loginInProgress.current = false;
        return;
      }

      // Success - show toast
      toast.success("Login successful! Redirecting to dashboard...");
      
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      // Set a timeout fallback to reset loading state if redirect doesn't happen
      // This prevents infinite loading if UserContext takes too long to update
      timeoutRef.current = setTimeout(() => {
        if (loginInProgress.current) {
          setLoading(false);
          loginInProgress.current = false;
          // If user context hasn't updated after 3 seconds, try redirect anyway
          if (data.user) {
            router.replace("/dashboard");
          }
        }
      }, 3000);
      
    } catch (err: unknown) {
      // Clear timeout on error
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      
      // Properly extract error message from various error types
      let errorMessage: string = '';
      
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (err && typeof err === 'object' && 'message' in err) {
        errorMessage = String((err as { message?: unknown }).message || '');
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else {
        errorMessage = String(err);
      }
      
      // Check for network errors
      if (errorMessage.toLowerCase().includes('failed to fetch') || 
          errorMessage.toLowerCase().includes('networkerror') ||
          errorMessage.toLowerCase().includes('network')) {
        const networkError = 'Network error. Please check your internet connection and try again.';
        setError(networkError);
        toast.error(networkError);
        setLoading(false);
        loginInProgress.current = false;
        return;
      }
      
      // Map Supabase error to user-friendly message
      const userMessage = errorMessage 
        ? mapSupabaseAuthError(errorMessage)
        : "Incorrect email or password. Please try again.";
      
      setError(userMessage);
      toast.error(userMessage);
      setLoading(false);
      loginInProgress.current = false;
      
      // Log error for debugging (only in development)
      if (process.env.NODE_ENV === 'development') {
        console.error('[Login] Error details:', err);
      }
    }
  };


  // Prevent hydration mismatch by not rendering form until mounted
  if (!mounted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="h-10 w-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
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
          <h2 className="text-xl font-medium text-gray-700 mb-8">Sign in to your expert account</h2>
          <p className="text-gray-600 text-lg leading-relaxed text-justify">
            Access your expert dashboard to validate and manage content with precision and efficiency.
          </p>
        </div>
      </div>

      {/* Right side - Login Form Card */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile Welcome Text */}
          <div className="lg:hidden mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Welcome Back</h1>
            <h2 className="text-lg font-medium text-gray-700 mb-6">Sign in to your expert account</h2>
            <p className="text-gray-600 text-base leading-relaxed text-justify mb-8">
              Access your expert dashboard to validate and manage content with precision and efficiency.
            </p>
          </div>

          {/* Form Card */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg p-8">
            <form onSubmit={onSubmit} className="space-y-6">
              {/* Email Field */}
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
                disabled={loading} 
                className="w-full py-3 px-4 rounded-lg bg-[#388E3C] text-white font-medium hover:bg-[#2F7A33] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {loading ? "Signing In..." : "Sign In"}
              </button>
            </form>

            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="mt-8 text-center">
              <p className="text-sm text-gray-600">
                Don&apos;t have an account?{" "}
                <Link href="/register" className="text-[#388E3C] hover:text-[#2F7A33] font-medium hover:underline transition-colors">
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


