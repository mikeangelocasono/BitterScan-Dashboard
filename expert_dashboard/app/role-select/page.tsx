"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { ChevronDown, UserCircle } from "lucide-react";
import { supabase } from "@/components/supabase";

export default function RoleSelectPage() {
  const router = useRouter();
  const [selectedRole, setSelectedRole] = useState<"expert" | "admin" | "">("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // Only clear session if explicitly coming from a logout or fresh start
    // Don't clear session on every mount to allow proper session persistence
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      // Only clear if there's a session but user explicitly navigated here
      // (not from app initialization)
      if (session && typeof window !== 'undefined') {
        const fromLogout = sessionStorage.getItem('bs:from-logout');
        if (fromLogout === 'true') {
          // Clear the flag
          sessionStorage.removeItem('bs:from-logout');
          // Sign out to ensure clean state
          await supabase.auth.signOut();
        }
      }
    };
    
    checkSession();
  }, []);

  const handleContinue = () => {
    if (!selectedRole) {
      return;
    }
    // Redirect to login with selected role as query param
    router.push(`/login?role=${selectedRole}`);
  };

  // Prevent hydration mismatch
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
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-green-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4" style={{ backgroundColor: '#E6F3E7' }}>
            <UserCircle className="w-10 h-10 text-[#388E3C]" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome to BitterScan</h1>
          <p className="text-gray-600">Please select how you want to log in</p>
        </div>

        {/* Role Selection Card */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-xl p-8">
          <label className="block text-sm font-semibold text-gray-900 mb-3">
            Select Your Role
          </label>
          
          <div className="relative mb-6">
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value as "expert" | "admin" | "")}
              className="w-full px-4 py-3 pr-10 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-all duration-200 bg-gray-50 focus:bg-white text-gray-900 appearance-none cursor-pointer"
            >
              <option value="" disabled>
                Choose your login role...
              </option>
              <option value="expert">Expert</option>
              <option value="admin">Admin</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
          </div>

          {/* Role Description */}
          {selectedRole && (
            <div 
              className="mb-6 p-4 rounded-lg transition-all duration-300 ease-out animate-[fadeIn_0.3s_ease-out]" 
              style={{ 
                backgroundColor: '#E6F3E7', 
                borderColor: '#A7D3AA', 
                border: '1px solid'
              }}
            >
              {selectedRole === "expert" ? (
                <div className="flex gap-3">
                  <UserCircle className="w-5 h-5 text-[#388E3C] flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">Expert Account</h3>
                    <p className="text-sm text-gray-700">
                      Access your expert dashboard to validate and manage scans. You can create a new account if you don&apos;t have one.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <UserCircle className="w-5 h-5 text-[#388E3C] flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">Admin Account</h3>
                    <p className="text-sm text-gray-700">
                      Access administrative features and manage the system. Admin accounts are created by the MAGRO Head Expert.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Continue Button */}
          <button
            onClick={handleContinue}
            disabled={!selectedRole}
            className="w-full py-3 px-4 rounded-lg bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white font-medium hover:from-[#2F7A33] hover:to-[#1B5E20] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
          >
            Continue to Login
          </button>
        </div>

        {/* Footer Info */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-500">
            Secure login powered by BitterScan
          </p>
        </div>
      </div>
    </div>
  );
}
