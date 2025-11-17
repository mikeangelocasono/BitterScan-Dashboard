"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { supabase } from "@/components/supabase";
import toast from "react-hot-toast";
import { User, Mail, Lock, UserCheck, Eye, EyeOff } from "lucide-react";
import { mapSupabaseAuthError, mapSupabaseDbError, validateEmail, validateUsername, validatePasswordStrength } from "@/utils/authErrors";

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Ensure component is mounted on client to avoid hydration issues
  useEffect(() => {
    setMounted(true);
  }, []);

  // Real-time password validation
  const passwordValidation = validatePasswordStrength(password);
  const hasMinLength = password.length >= 8;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const passwordValid = passwordValidation.isValid;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Validation
    if (!fullName || !username || !email || !password) {
      toast.error("All fields are required");
      setError("All fields are required");
      setLoading(false);
      return;
    }

    if (!validateEmail(email)) {
      toast.error("Invalid email format");
      setError("Invalid email format");
      setLoading(false);
      return;
    }

    // Username validation
    const usernameValidation = validateUsername(username);
    if (!usernameValidation.isValid) {
      toast.error(usernameValidation.error || "Invalid username");
      setError(usernameValidation.error || "Invalid username");
      setLoading(false);
      return;
    }

    // Password policy check
    if (!passwordValid) {
      const errorMessage = passwordValidation.errors.join('. ');
      toast.error(errorMessage);
      setError(errorMessage);
      setLoading(false);
      return;
    }

    // Validate environment variables are available
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      const configError = 'Supabase client is not properly configured. Please check your environment variables.';
      setError(configError);
      toast.error(configError);
      setLoading(false);
      return;
    }

    // Proactive uniqueness checks for better UX
    try {
      const { data: userNameExists, error: usernameCheckError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username.trim())
        .maybeSingle();
      
      if (usernameCheckError && usernameCheckError.code !== 'PGRST116') {
        // PGRST116 is "not found" which is fine, other errors should be logged
        console.warn('Error checking username:', usernameCheckError);
      }
      
      if (userNameExists) {
        const msg = "Username already exists";
        toast.error(msg);
        setError(msg);
        setLoading(false);
        return;
      }
      
      const { data: emailExists, error: emailCheckError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();
      
      if (emailCheckError && emailCheckError.code !== 'PGRST116') {
        console.warn('Error checking email:', emailCheckError);
      }
      
      if (emailExists) {
        const msg = "Email already exists";
        toast.error(msg);
        setError(msg);
        setLoading(false);
        return;
      }
    } catch (err) {
      // Continue to auth flow; server constraints will still enforce uniqueness
      console.warn('Error during uniqueness check:', err);
    }

    try {
      // Create user with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            username: username.trim(),
            role: 'expert'
          }
        }
      });

      // Check for authentication errors
      if (authError) {
        let errorMessage = authError.message || '';
        
        // Handle specific error cases
        if (authError.status === 400) {
          if (errorMessage.toLowerCase().includes('already registered') || 
              errorMessage.toLowerCase().includes('user already exists')) {
            errorMessage = 'An account with this email already exists. Please try signing in instead.';
          } else if (errorMessage.toLowerCase().includes('password')) {
            errorMessage = 'Password does not meet requirements.';
          }
        } else if (authError.status === 429) {
          errorMessage = 'Too many registration attempts. Please try again later.';
        } else if (authError.status === 500) {
          errorMessage = 'Server error. Please try again later.';
        }
        
        const userMessage = mapSupabaseAuthError(errorMessage || 'Registration failed');
        setError(userMessage);
        toast.error(userMessage);
        setLoading(false);
        return;
      }

      // Verify user was created
      if (!authData || !authData.user) {
        const noUserError = "Registration failed. No user data returned.";
        setError(noUserError);
        toast.error(noUserError);
        setLoading(false);
        return;
      }

      // Create or update profile
      const { error: profileUpsertError } = await supabase
        .from('profiles')
        .upsert({
          id: authData.user.id,
          username: username.trim(),
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          role: 'expert',
        }, { 
          onConflict: 'id',
          ignoreDuplicates: false 
        });

      if (profileUpsertError) {
        // Map database errors
        const dbErrorMessage = mapSupabaseDbError(profileUpsertError.message) || 
                               mapSupabaseAuthError(profileUpsertError.message) ||
                               'Failed to create profile. Please try again.';
        setError(dbErrorMessage);
        toast.error(dbErrorMessage);
        setLoading(false);
        return;
      }

      // Success
      toast.success("Your account has been successfully created. You can now log in.");
      router.push("/login");
      
    } catch (err: unknown) {
      // Handle unexpected errors
      let errorMessage = '';
      
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
        return;
      }
      
      // Try to map database errors first, then auth errors
      const message = mapSupabaseDbError(errorMessage) || 
                     mapSupabaseAuthError(errorMessage) || 
                     "Registration failed. Please check your details and try again.";
      setError(message);
      toast.error(message);
      
      // Log error for debugging (only in development)
      if (process.env.NODE_ENV === 'development') {
        console.error('[Register] Error details:', err);
      }
    } finally {
      setLoading(false);
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
          <h1 className="text-4xl font-bold text-gray-900 mb-6">Join Us Today</h1>
          <h2 className="text-xl font-medium text-gray-700 mb-8">Create your expert account</h2>
          <p className="text-gray-600 text-lg leading-relaxed text-justify">
            Gain access to your expert dashboard to validate and manage content with precision and efficiency.
          </p>
        </div>
      </div>

      {/* Right side - Register Form Card */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile Welcome Text */}
          <div className="lg:hidden mb-8 text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Join Us Today</h1>
            <h2 className="text-lg font-medium text-gray-700 mb-6">Create your expert account</h2>
            <p className="text-gray-600 text-base leading-relaxed text-justify mb-8">
              Gain access to your expert dashboard to validate and manage content with precision and efficiency.
            </p>
          </div>

          {/* Form Card */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg p-8">
            <form onSubmit={onSubmit} className="space-y-6">
              {/* Full Name Field */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Full Name</label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <input 
                    type="text"
                    value={fullName} 
                    onChange={(e) => setFullName(e.target.value)} 
                    required 
                    autoComplete="name"
                    suppressHydrationWarning
                    className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-all duration-200 bg-gray-50 focus:bg-white text-gray-900" 
                    placeholder="Enter your full name"
                  />
                </div>
              </div>

              {/* Username Field */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Username</label>
                <div className="relative">
                  <UserCheck className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <input 
                    type="text"
                    value={username} 
                    onChange={(e) => setUsername(e.target.value)} 
                    required 
                    autoComplete="username"
                    suppressHydrationWarning
                    className="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-all duration-200 bg-gray-50 focus:bg-white text-gray-900" 
                    placeholder="Choose a username"
                  />
                </div>
              </div>

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
                    suppressHydrationWarning
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
                    autoComplete="new-password"
                    suppressHydrationWarning
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
                {/* Password live feedback */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className={`rounded-md px-2 py-1 border ${hasMinLength ? 'border-green-200 bg-green-50 text-[#388E3C]' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>8+ characters</div>
                  <div className={`rounded-md px-2 py-1 border ${hasLetter ? 'border-green-200 bg-green-50 text-[#388E3C]' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>letters</div>
                  <div className={`rounded-md px-2 py-1 border ${hasNumber ? 'border-green-200 bg-green-50 text-[#388E3C]' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>numbers</div>
                  <div className={`rounded-md px-2 py-1 border ${hasSymbol ? 'border-green-200 bg-green-50 text-[#388E3C]' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>symbols</div>
                </div>
              </div>

              {/* Submit Button */}
              <button 
                type="submit" 
                disabled={loading || !passwordValid || !fullName || !username || !email} 
                className="w-full py-3 px-4 rounded-lg bg-[#388E3C] text-white font-medium hover:bg-[#2F7A33] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                {loading ? "Creating Account..." : "Sign Up"}
              </button>
            </form>

            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <div className="mt-8 text-center">
              <p className="text-sm text-gray-600">
                Already have an account?{" "}
                <Link href="/login" className="text-[#388E3C] hover:text-[#2F7A33] font-medium hover:underline transition-colors">
                  Sign In
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


