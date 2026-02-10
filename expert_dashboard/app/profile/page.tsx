"use client";

import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useUser } from "@/components/UserContext";
import { User, Mail, UserCheck, Shield, Edit2, Save, X, Loader2 } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import toast from "react-hot-toast";
import { supabase } from "@/components/supabase";

const PROFILE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "UTC",
});

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useUser();
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    full_name: "",
    username: "",
  });
  const [loading, setLoading] = useState(false);

  // Memoize user data to prevent unnecessary recalculations
  const userInitials = useMemo(() => {
    if (profile?.full_name) {
      return profile.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
    }
    if (user?.user_metadata?.full_name) {
      return user.user_metadata.full_name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return 'EX';
  }, [profile?.full_name, user?.user_metadata?.full_name]);

  const displayName = useMemo(() => {
    return profile?.full_name || user?.user_metadata?.full_name || "Expert User";
  }, [profile?.full_name, user?.user_metadata?.full_name]);

  const userRole = useMemo(() => {
    return profile?.role || user?.user_metadata?.role || "Expert";
  }, [profile?.role, user?.user_metadata?.role]);

  const username = useMemo(() => {
    return profile?.username || user?.user_metadata?.username || "N/A";
  }, [profile?.username, user?.user_metadata?.username]);

  const email = useMemo(() => {
    return user?.email || "N/A";
  }, [user?.email]);

  // Initialize form data when profile loads
  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || "",
        username: profile.username || "",
      });
    }
  }, [profile]);

  // Form validation
  const validateForm = useCallback(() => {
    if (!formData.full_name.trim()) {
      toast.error('Full name is required');
      return false;
    }
    if (formData.full_name.trim().length < 2) {
      toast.error('Full name must be at least 2 characters');
      return false;
    }
    if (!formData.username.trim()) {
      toast.error('Username is required');
      return false;
    }
    if (formData.username.trim().length < 3) {
      toast.error('Username must be at least 3 characters');
      return false;
    }
    // Username validation: alphanumeric and underscores only
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(formData.username.trim())) {
      toast.error('Username can only contain letters, numbers, and underscores');
      return false;
    }
    return true;
  }, [formData]);

  // Handle form submission
  const handleSave = useCallback(async () => {
    if (!profile) return;
    
    // Validate form
    if (!validateForm()) return;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name.trim(),
          username: formData.username.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', profile.id);

      if (error) throw error;

      toast.success('Profile updated successfully');
      setIsEditing(false);
      await refreshProfile();
    } catch (error: unknown) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Error updating profile:', error);
      }
      const errorMessage = error instanceof Error ? error.message : 'Failed to update profile. Please try again.';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [profile, formData, refreshProfile, validateForm]);

  // Handle cancel editing
  const handleCancel = useCallback(() => {
    setFormData({
      full_name: profile?.full_name || "",
      username: profile?.username || "",
    });
    setIsEditing(false);
  }, [profile]);

  return (
    <AuthGuard>
      <AppShell>
        <div className="space-y-6 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Profile</h1>
              <p className="text-sm text-gray-500 mt-1">Manage your account information and preferences</p>
            </div>
            {!isEditing ? (
              <Button 
                onClick={() => setIsEditing(true)}
                className="w-full sm:w-auto"
                size="lg"
              >
                <Edit2 className="h-4 w-4 mr-2" />
                Edit Profile
              </Button>
            ) : (
              <div className="flex gap-2 w-full sm:w-auto">
                <Button 
                  variant="outline" 
                  onClick={handleCancel}
                  disabled={loading}
                  className="flex-1 sm:flex-none"
                  size="lg"
                >
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </Button>
                <Button 
                  onClick={(e) => {
                    e.preventDefault();
                    handleSave().catch((error) => {
                      console.error('Error in handleSave:', error);
                      toast.error('An unexpected error occurred');
                    });
                  }} 
                  disabled={loading}
                  className="flex-1 sm:flex-none"
                  size="lg"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
          
          {/* Profile Information Card */}
          <motion.div 
            initial={{ opacity: 0, y: 8 }} 
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="shadow-sm border border-gray-200 hover:shadow-md transition-all duration-200">
              <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 border-b rounded-t-xl">
                <CardTitle className="text-xl font-bold" style={{ color: 'white' }}>Profile Information</CardTitle>
                <p className="text-sm mt-1" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Your personal account details</p>
              </CardHeader>
              <CardContent className="pt-6">
                {/* Profile Header */}
                <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 pb-6 border-b">
                  <div className="h-20 w-20 rounded-full bg-[var(--primary)] text-white flex items-center justify-center text-2xl font-bold shadow-lg flex-shrink-0">
                    {userInitials}
                  </div>
                  <div className="flex-1 text-center sm:text-left">
                    <h2 className="text-2xl font-semibold text-gray-900 mb-1">{displayName}</h2>
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium">
                      <Shield className="h-3.5 w-3.5" />
                      {userRole}
                    </div>
                  </div>
                </div>

                {/* Profile Details Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6">
                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="p-2 bg-white rounded-lg shadow-sm">
                      <User className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Full Name</p>
                      <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="p-2 bg-white rounded-lg shadow-sm">
                      <UserCheck className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Username</p>
                      <p className="text-sm font-semibold text-gray-900 truncate">@{username}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="p-2 bg-white rounded-lg shadow-sm">
                      <Mail className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Email Address</p>
                      <p className="text-sm font-semibold text-gray-900 truncate">{email}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="p-2 bg-white rounded-lg shadow-sm">
                      <Shield className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Role</p>
                      <p className="text-sm font-semibold text-gray-900">{userRole}</p>
                    </div>
                  </div>
                </div>

                {/* Account Information */}
                <div className="mt-6 pt-6 border-t">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4">Account Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-gray-500 mb-1">Account Created</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {profile?.created_at ? PROFILE_DATE_FORMATTER.format(new Date(profile.created_at)) : 'N/A'}
                      </p>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-gray-500 mb-1">Last Updated</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {profile?.updated_at ? PROFILE_DATE_FORMATTER.format(new Date(profile.updated_at)) : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Edit Form Card - Only show when editing */}
          {isEditing && (
            <motion.div 
              initial={{ opacity: 0, y: 8 }} 
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <Card className="shadow-sm border border-gray-200 hover:shadow-md transition-all duration-200">
                <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 border-b rounded-t-xl">
                  <CardTitle className="text-xl font-bold" style={{ color: 'white' }}>Edit Profile</CardTitle>
                  <p className="text-sm mt-1" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Update your profile information</p>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="space-y-5">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Full Name <span className="text-red-500">*</span>
                      </label>
                      <input 
                        type="text"
                        value={formData.full_name}
                        onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
                        placeholder="Enter your full name"
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all disabled:bg-gray-50 disabled:text-gray-500"
                        disabled={loading}
                      />
                      <p className="text-xs text-gray-500 mt-1.5">This will be displayed as your name</p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Username <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                        <input 
                          type="text"
                          value={formData.username}
                          onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') }))}
                          placeholder="username"
                          className="w-full rounded-lg border border-gray-300 px-4 pl-8 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all disabled:bg-gray-50 disabled:text-gray-500"
                          disabled={loading}
                        />
                      </div>
                      <p className="text-xs text-gray-500 mt-1.5">Only letters, numbers, and underscores allowed</p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
                      <input 
                        type="email"
                        value={email} 
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm bg-gray-50 text-gray-500 cursor-not-allowed" 
                        disabled 
                      />
                      <p className="text-xs text-gray-500 mt-1.5">Email cannot be changed. Contact support if you need to update it.</p>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Role</label>
                      <input 
                        type="text"
                        value={userRole} 
                        className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm bg-gray-50 text-gray-500 cursor-not-allowed" 
                        disabled 
                      />
                      <p className="text-xs text-gray-500 mt-1.5">Your role is assigned by the system administrator</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </div>
      </AppShell>
    </AuthGuard>
  );
}


