"use client";

import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { useUser } from "@/components/UserContext";
import { User, Mail, UserCheck, Shield } from "lucide-react";
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

  // Handle form submission
  const handleSave = useCallback(async () => {
    if (!profile) return;
    
    setLoading(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: formData.full_name,
          username: formData.username,
          updated_at: new Date().toISOString()
        })
        .eq('id', profile.id);

      if (error) throw error;

      toast.success('Profile updated successfully');
      setIsEditing(false);
      await refreshProfile();
    } catch (error: unknown) {
      console.error('Error updating profile:', error);
      toast.error('Failed to update profile. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [profile, formData, refreshProfile]);

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
        <div className="space-y-6 max-w-4xl">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold">Profile</h2>
            {!isEditing ? (
              <Button onClick={() => setIsEditing(true)}>Edit Profile</Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleCancel}>Cancel</Button>
                <Button onClick={handleSave} disabled={loading}>
                  {loading ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            )}
          </div>
          
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Expert Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Profile Header */}
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center text-xl font-semibold shadow-lg">
                    {userInitials}
                  </div>
                  <div>
                    <div className="text-xl font-semibold">{displayName}</div>
                    <div className="text-sm text-gray-500">{userRole}</div>
                  </div>
                </div>

                {/* Profile Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <User className="h-5 w-5 text-gray-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Full Name</p>
                        <p className="text-sm text-gray-600">{displayName}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <UserCheck className="h-5 w-5 text-gray-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Username</p>
                        <p className="text-sm text-gray-600">{username}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <Mail className="h-5 w-5 text-gray-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Email</p>
                        <p className="text-sm text-gray-600">{email}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                      <Shield className="h-5 w-5 text-gray-500" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">Role</p>
                        <p className="text-sm text-gray-600">{userRole}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Account Info */}
                <div className="border-t pt-4">
                  <h3 className="text-sm font-medium text-gray-900 mb-3">Account Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Account Created:</span>
                      <span className="ml-2 text-gray-900">
                        {profile?.created_at ? PROFILE_DATE_FORMATTER.format(new Date(profile.created_at)) : 'N/A'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">Last Updated:</span>
                      <span className="ml-2 text-gray-900">
                        {profile?.updated_at ? PROFILE_DATE_FORMATTER.format(new Date(profile.updated_at)) : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <input 
                      value={formData.full_name}
                      onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                      disabled={!isEditing}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                    <input 
                      value={formData.username}
                      onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                      className="w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                      disabled={!isEditing}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input 
                      value={email} 
                      className="w-full rounded-md border border-gray-300 px-3 py-2 bg-gray-50 text-gray-500" 
                      disabled 
                    />
                    <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                    <input 
                      value={userRole} 
                      className="w-full rounded-md border border-gray-300 px-3 py-2 bg-gray-50 text-gray-500" 
                      disabled 
                    />
                    <p className="text-xs text-gray-500 mt-1">Role cannot be changed</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
      </AppShell>
    </AuthGuard>
  );
}


