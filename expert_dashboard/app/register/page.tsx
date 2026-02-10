"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { User, Mail, Lock, UserCheck, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { validateEmail, validateUsername, validatePasswordStrength } from "@/utils/authErrors";

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

    try {
      // Call server-side registration API (bypasses RLS policies)
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password: password,
          username: username.trim(),
          fullName: fullName.trim(),
        }),
      });

      const data = await response.json();

      // Handle error responses
      if (!response.ok) {
        const errorMessage = data.error || 'Registration failed. Please try again.';
        setError(errorMessage);
        toast.error(errorMessage);
        setLoading(false);
        return;
      }

      // Success - Show success message with approval notice
      toast.success("Registration successful! Please wait for admin approval to validate your Expert account.", {
        duration: 6000,
      });
      
      // Redirect to login page with role parameter
      router.push("/login?role=expert");
      
    } catch (err: unknown) {
      // Handle unexpected errors (primarily network errors)
      let errorMessage = 'Registration failed. Please try again.';
      
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      }
      
      // Check for network errors
      if (errorMessage.toLowerCase().includes('failed to fetch') || 
          errorMessage.toLowerCase().includes('networkerror') ||
          errorMessage.toLowerCase().includes('network')) {
        errorMessage = 'Network error. Please check your internet connection and try again.';
      }
      
      setError(errorMessage);
      toast.error(errorMessage);
      
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
            {/* Back to Login */}
            <Link 
              href="/login?role=expert" 
              className="inline-flex items-center text-sm text-gray-600 hover:text-[#388E3C] transition-colors mb-6 group"
            >
              <ArrowLeft className="h-4 w-4 mr-1 group-hover:-translate-x-1 transition-transform" />
              Back to Login
            </Link>

            <form onSubmit={onSubmit} className="space-y-6">{/* Full Name Field */}
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
                  <div className={`rounded-md px-2 py-1 border ${hasMinLength ? 'text-[#388E3C]' : 'border-gray-200 bg-gray-50 text-gray-500'}`} style={hasMinLength ? { backgroundColor: '#E6F3E7', borderColor: '#A7D3AA' } : undefined}>8+ characters</div>
                  <div className={`rounded-md px-2 py-1 border ${hasLetter ? 'text-[#388E3C]' : 'border-gray-200 bg-gray-50 text-gray-500'}`} style={hasLetter ? { backgroundColor: '#E6F3E7', borderColor: '#A7D3AA' } : undefined}>letters</div>
                  <div className={`rounded-md px-2 py-1 border ${hasNumber ? 'text-[#388E3C]' : 'border-gray-200 bg-gray-50 text-gray-500'}`} style={hasNumber ? { backgroundColor: '#E6F3E7', borderColor: '#A7D3AA' } : undefined}>numbers</div>
                  <div className={`rounded-md px-2 py-1 border ${hasSymbol ? 'text-[#388E3C]' : 'border-gray-200 bg-gray-50 text-gray-500'}`} style={hasSymbol ? { backgroundColor: '#E6F3E7', borderColor: '#A7D3AA' } : undefined}>symbols</div>
                </div>
              </div>

              {/* Submit Button */}
              <button 
                type="submit" 
                disabled={loading || !passwordValid || !fullName || !username || !email} 
                className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white font-medium hover:from-[#2F7A33] hover:to-[#1B5E20] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Creating Account...</span>
                  </>
                ) : (
                  "Sign Up"
                )}
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
                <Link href="/login?role=expert" className="text-[#388E3C] hover:text-[#2F7A33] font-medium hover:underline transition-colors">
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


