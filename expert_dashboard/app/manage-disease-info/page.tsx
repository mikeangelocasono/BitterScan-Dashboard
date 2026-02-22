"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/components/supabase";
import { useUser } from "@/components/UserContext";
import { 
  Loader2, Save, BookOpen, AlertCircle, CheckCircle2, Edit2, X, 
  FileText, Stethoscope, Pill, ShieldCheck, Leaf, Search, Plus, Eye, Trash2
} from "lucide-react";
import toast from "react-hot-toast";

type DiseaseInfo = {
  disease_id: string;
  disease_name: string;
  description_en: string | null;
  description_bi: string | null;
  symptoms_en: string | null;
  symptoms_bi: string | null;
  treatment_en: string | null;
  treatment_bi: string | null;
  products_en: string | null;
  products_bi: string | null;
  prevention_en: string | null;
  prevention_bi: string | null;
  last_updated_by?: string;
  updated_at?: string;
};

type EditingDisease = DiseaseInfo & {
  isEditing: boolean;
};

export default function ManageDiseaseInfoPage() {
  return (
    <AuthGuard>
      <AppShell>
        <ManageDiseaseInfoContent />
      </AppShell>
    </AuthGuard>
  );
}

function ManageDiseaseInfoContent() {
  const router = useRouter();
  const { user, profile, loading: userLoading, sessionReady } = useUser();
  const [diseases, setDiseases] = useState<EditingDisease[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [editingDisease, setEditingDisease] = useState<EditingDisease | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [viewingDisease, setViewingDisease] = useState<DiseaseInfo | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [fetchAttempted, setFetchAttempted] = useState(false);

  const effectiveRole = useMemo(() => profile?.role || user?.user_metadata?.role || null, [profile?.role, user?.user_metadata?.role]);
  const isAuthorized = useMemo(() => effectiveRole === "expert" || effectiveRole === "admin", [effectiveRole]);

  // Redirect unauthorized users - only after session is ready
  useEffect(() => {
    if (sessionReady && !userLoading && user && !isAuthorized) {
      toast.error("Access denied. Experts and Admins only.");
      router.replace("/dashboard");
    }
  }, [sessionReady, userLoading, user, isAuthorized, router]);

  // Fetch disease information with timeout protection
  const fetchDiseases = useCallback(async () => {
    setLoading(true);
    setFetchAttempted(true);
    
    // Add timeout to prevent infinite loading
    const timeoutId = setTimeout(() => {
      console.warn('[ManageDiseaseInfo] Fetch timeout - forcing loading state to clear');
      setLoading(false);
    }, 15000); // 15 second timeout
    
    try {
      const { data, error } = await supabase
        .from("disease_info")
        .select("*")
        .order("disease_name", { ascending: true });

      clearTimeout(timeoutId);

      if (error) {
        console.error("Error fetching diseases:", error);
        toast.error("Failed to load disease information");
        setDiseases([]);
        return;
      }

      setDiseases((data || []).map(d => ({ ...d, isEditing: false })));
    } catch (err) {
      clearTimeout(timeoutId);
      console.error("Unexpected error fetching diseases:", err);
      toast.error("Failed to load disease information");
      setDiseases([]);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  // Wait for sessionReady before fetching data - this ensures auth is resolved
  useEffect(() => {
    // Only proceed when session is ready (user + profile resolved or confirmed null)
    if (!sessionReady) return;
    
    // If user is authorized, fetch data
    if (isAuthorized) {
      fetchDiseases();
    } else {
      // Not authorized or no user - stop loading
      setLoading(false);
    }
  }, [sessionReady, isAuthorized, fetchDiseases]);

  // Master timeout: prevent infinite loading in any edge case
  useEffect(() => {
    if (!loading) return;
    
    const masterTimeout = setTimeout(() => {
      if (loading) {
        console.warn('[ManageDiseaseInfo] Master timeout - clearing loading state');
        setLoading(false);
      }
    }, 10000); // 10 second master timeout
    
    return () => clearTimeout(masterTimeout);
  }, [loading]);

  // Filter diseases based on search query
  const filteredDiseases = useMemo(() => {
    if (!searchQuery.trim()) return diseases;
    const query = searchQuery.toLowerCase();
    return diseases.filter(disease => 
      disease.disease_name.toLowerCase().includes(query)
    );
  }, [diseases, searchQuery]);

  // Open edit dialog
  const openEditDialog = useCallback((disease: EditingDisease) => {
    setEditingDisease({ ...disease, isEditing: true });
    setIsDialogOpen(true);
  }, []);

  // Close edit dialog
  const closeEditDialog = useCallback(() => {
    setIsDialogOpen(false);
    setEditingDisease(null);
  }, []);

  // Open view dialog
  const openViewDialog = useCallback((disease: DiseaseInfo) => {
    setViewingDisease(disease);
    setIsViewDialogOpen(true);
  }, []);

  // Close view dialog
  const closeViewDialog = useCallback(() => {
    setIsViewDialogOpen(false);
    setViewingDisease(null);
  }, []);

  // Toggle edit mode
  const toggleEdit = useCallback((id: string) => {
    setDiseases(prev => prev.map(d => 
      d.disease_id === id ? { ...d, isEditing: !d.isEditing } : d
    ));
  }, []);

  // Update field value
  const updateField = useCallback((id: string, field: keyof DiseaseInfo, value: string) => {
    setDiseases(prev => prev.map(d => 
      d.disease_id === id ? { ...d, [field]: value } : d
    ));
    // Also update editing disease if it's open
    setEditingDisease(prev => prev && prev.disease_id === id ? { ...prev, [field]: value } : prev);
  }, []);

  // Normalize a field value for safe comparison: trims whitespace, converts null/undefined to empty string
  const normalize = useCallback((value: string | null | undefined): string => {
    return (value ?? "").trim();
  }, []);

  // English-to-Bisaya field mapping for translation invalidation
  const enBiFieldPairs: [keyof DiseaseInfo, keyof DiseaseInfo][] = useMemo(() => [
    ["description_en", "description_bi"],
    ["symptoms_en", "symptoms_bi"],
    ["treatment_en", "treatment_bi"],
    ["products_en", "products_bi"],
    ["prevention_en", "prevention_bi"],
  ], []);

  // Save disease information
  const saveDisease = useCallback(async (disease: EditingDisease) => {
    if (savingId) return; // Prevent multiple simultaneous saves

    setSavingId(disease.disease_id);
    try {
      // 1. Fetch existing record to compare English fields
      const { data: existing, error: fetchError } = await supabase
        .from("disease_info")
        .select("*")
        .eq("disease_id", disease.disease_id)
        .single();

      if (fetchError || !existing) {
        console.error("Error fetching existing disease record:", fetchError);
        toast.error("Disease record not found. It may have been deleted.");
        return;
      }

      // 2. Build update payload, resetting Bisaya fields when their English counterpart changed
      const updatePayload: Record<string, string | null> = {
        description_en: disease.description_en,
        description_bi: disease.description_bi,
        symptoms_en: disease.symptoms_en,
        symptoms_bi: disease.symptoms_bi,
        treatment_en: disease.treatment_en,
        treatment_bi: disease.treatment_bi,
        products_en: disease.products_en,
        products_bi: disease.products_bi,
        prevention_en: disease.prevention_en,
        prevention_bi: disease.prevention_bi,
      };

      for (const [enField, biField] of enBiFieldPairs) {
        const oldEn = normalize(existing[enField] as string | null);
        const newEn = normalize(disease[enField] as string | null);
        if (oldEn !== newEn) {
          // English content changed — invalidate the paired Bisaya translation
          updatePayload[biField] = null;
        }
      }

      const { error } = await supabase
        .from("disease_info")
        .update({
          ...updatePayload,
          last_updated_by: user?.id,
          updated_at: new Date().toISOString(),
        })
        .eq("disease_id", disease.disease_id);

      if (error) {
        console.error("Error saving disease:", error);
        toast.error(`Failed to save ${disease.disease_name}`);
        return;
      }

      toast.success(`${disease.disease_name} updated successfully`);
      toggleEdit(disease.disease_id);
      closeEditDialog();
      await fetchDiseases(); // Refresh data
    } catch (err) {
      console.error("Unexpected error saving disease:", err);
      toast.error("Failed to save changes");
    } finally {
      setSavingId(null);
    }
  }, [savingId, toggleEdit, fetchDiseases, closeEditDialog, user?.id, normalize, enBiFieldPairs]);

  // Cancel editing
  const cancelEdit = useCallback((id: string) => {
    toggleEdit(id);
    fetchDiseases(); // Reset to original data
  }, [toggleEdit, fetchDiseases]);

  // Show loading only when session isn't ready OR when actively loading data
  // Use sessionReady to prevent infinite loading if auth has issues
  const isLoading = !sessionReady || loading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-gray-500 mx-auto mb-4" />
          <p className="text-gray-600">Loading diseases...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null; // Redirect is handled in useEffect
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-gray-900">Disease Information</h2>
      </div>

      {/* Search and Actions Bar */}
      <Card className="border-gray-200 shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
            {/* Search Bar */}
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                placeholder="Search diseases..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border-2 border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent text-sm transition-all duration-200"
              />
            </div>

            {/* Add New Disease Button */}
            <Button
              onClick={() => toast("Add New Disease feature coming soon")}
              className="bg-[#16a085] hover:bg-[#138f75] text-white font-medium shadow-md hover:shadow-lg transition-all duration-200 whitespace-nowrap"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add New Disease
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Disease Table */}
      {filteredDiseases.length === 0 ? (
        <Card className="border-2 border-dashed border-gray-300">
          <CardContent className="py-16">
            <div className="flex flex-col items-center justify-center text-center space-y-4">
              <div className="h-20 w-20 rounded-full bg-gray-100 flex items-center justify-center">
                <AlertCircle className="h-10 w-10 text-gray-400" />
              </div>
              <div className="space-y-2">
                <p className="text-lg font-semibold text-gray-700">
                  {searchQuery ? "No diseases found" : "No Disease Information Available"}
                </p>
                <p className="text-sm text-gray-500 max-w-md">
                  {searchQuery 
                    ? "Try adjusting your search query" 
                    : "Disease data will appear here once added to the database. Contact your administrator to add disease information."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-sm border border-gray-200 hover:shadow-md transition-all duration-200 overflow-hidden">
          <CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 border-b">
            <CardTitle className="text-xl font-bold" style={{ color: 'white' }}>Disease Database</CardTitle>
            <p className="text-sm mt-1" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Manage disease information in English and Bisaya</p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Disease Name
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Languages
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Last Updated
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredDiseases.map((disease) => (
                  <tr key={disease.disease_id} className="hover:bg-gray-50 transition-colors duration-150">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{disease.disease_name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex gap-2">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          English
                        </span>
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          Bisaya
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-600">
                        {disease.updated_at 
                          ? new Date(disease.updated_at).toLocaleDateString('en-US', { 
                              year: 'numeric', 
                              month: 'short', 
                              day: 'numeric' 
                            })
                          : 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openViewDialog(disease)}
                          className="p-2 text-gray-600 hover:text-[#388E3C] hover:bg-gray-100 rounded-lg transition-all duration-150"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => openEditDialog(disease)}
                          className="p-2 text-gray-600 hover:text-[#388E3C] hover:bg-gray-100 rounded-lg transition-all duration-150"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => toast("Delete feature coming soon")}
                          className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all duration-150"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CardContent>
        </Card>
      )}

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={(open) => {
        if (!open) closeViewDialog();
      }}>
        <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="bg-gradient-to-r from-[#388E3C] to-[#2F7A33] px-6 py-5 border-b-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-bold text-white flex items-center gap-3">
                <BookOpen className="h-6 w-6" />
                {viewingDisease?.disease_name}
              </DialogTitle>
              <button
                onClick={closeViewDialog}
                className="text-white/80 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </DialogHeader>
          <DialogContent className="overflow-y-auto flex-1 p-6">
            {viewingDisease && (
              <div className="space-y-5">
                <ViewField
                  label="Description"
                  icon={<FileText className="h-4 w-4" />}
                  englishValue={viewingDisease.description_en || ""}
                  bisayaValue={viewingDisease.description_bi || ""}
                />
                <ViewField
                  label="Symptoms"
                  icon={<Stethoscope className="h-4 w-4" />}
                  englishValue={viewingDisease.symptoms_en || ""}
                  bisayaValue={viewingDisease.symptoms_bi || ""}
                />
                <ViewField
                  label="Treatment"
                  icon={<Pill className="h-4 w-4" />}
                  englishValue={viewingDisease.treatment_en || ""}
                  bisayaValue={viewingDisease.treatment_bi || ""}
                />
                <ViewField
                  label="Products"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  englishValue={viewingDisease.products_en || ""}
                  bisayaValue={viewingDisease.products_bi || ""}
                />
                <ViewField
                  label="Prevention"
                  icon={<ShieldCheck className="h-4 w-4" />}
                  englishValue={viewingDisease.prevention_en || ""}
                  bisayaValue={viewingDisease.prevention_bi || ""}
                />
              </div>
            )}
          </DialogContent>
        </div>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        if (!open) closeEditDialog();
      }}>
        <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="bg-gradient-to-r from-[#388E3C] to-[#2F7A33] px-6 py-5 border-b-0">
            <DialogTitle className="text-xl font-bold text-white flex items-center gap-3">
              <Edit2 className="h-6 w-6" />
              Edit {editingDisease?.disease_name}
            </DialogTitle>
          </DialogHeader>
          <DialogContent className="overflow-y-auto flex-1 p-6">
            {editingDisease && (
              <div className="space-y-5">
                <FieldGroup
                  label="Description"
                  icon={<FileText className="h-4 w-4" />}
                  englishValue={editingDisease.description_en || ""}
                  bisayaValue={editingDisease.description_bi || ""}
                  isEditing={true}
                  onEnglishChange={(val) => updateField(editingDisease.disease_id, "description_en", val)}
                  onBisayaChange={(val) => updateField(editingDisease.disease_id, "description_bi", val)}
                />
                <FieldGroup
                  label="Symptoms"
                  icon={<Stethoscope className="h-4 w-4" />}
                  englishValue={editingDisease.symptoms_en || ""}
                  bisayaValue={editingDisease.symptoms_bi || ""}
                  isEditing={true}
                  onEnglishChange={(val) => updateField(editingDisease.disease_id, "symptoms_en", val)}
                  onBisayaChange={(val) => updateField(editingDisease.disease_id, "symptoms_bi", val)}
                />
                <FieldGroup
                  label="Treatment"
                  icon={<Pill className="h-4 w-4" />}
                  englishValue={editingDisease.treatment_en || ""}
                  bisayaValue={editingDisease.treatment_bi || ""}
                  isEditing={true}
                  onEnglishChange={(val) => updateField(editingDisease.disease_id, "treatment_en", val)}
                  onBisayaChange={(val) => updateField(editingDisease.disease_id, "treatment_bi", val)}
                />
                <FieldGroup
                  label="Products"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  englishValue={editingDisease.products_en || ""}
                  bisayaValue={editingDisease.products_bi || ""}
                  isEditing={true}
                  onEnglishChange={(val) => updateField(editingDisease.disease_id, "products_en", val)}
                  onBisayaChange={(val) => updateField(editingDisease.disease_id, "products_bi", val)}
                />
                <FieldGroup
                  label="Prevention"
                  icon={<ShieldCheck className="h-4 w-4" />}
                  englishValue={editingDisease.prevention_en || ""}
                  bisayaValue={editingDisease.prevention_bi || ""}
                  isEditing={true}
                  onEnglishChange={(val) => updateField(editingDisease.disease_id, "prevention_en", val)}
                  onBisayaChange={(val) => updateField(editingDisease.disease_id, "prevention_bi", val)}
                />
              </div>
            )}
          </DialogContent>
          <DialogFooter className="bg-gray-50 px-6 py-4">
            <Button
              variant="outline"
              onClick={closeEditDialog}
              disabled={savingId === editingDisease?.disease_id}
              className="border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button
              onClick={(e) => {
                e.preventDefault();
                if (editingDisease) {
                  saveDisease(editingDisease).catch((error) => {
                    console.error('Error saving disease:', error);
                    toast.error('An unexpected error occurred');
                  });
                }
              }}
              disabled={savingId === editingDisease?.disease_id}
              className="bg-[#388E3C] hover:bg-[#2F7A33] text-white"
            >
              {savingId === editingDisease?.disease_id ? (
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
          </DialogFooter>
        </div>
      </Dialog>
    </div>
  );
}

// View-only field component
function ViewField({
  label,
  icon,
  englishValue,
  bisayaValue,
}: {
  label: string;
  icon: React.ReactNode;
  englishValue: string;
  bisayaValue: string;
}) {
  const hasContent = englishValue || bisayaValue;

  if (!hasContent) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg p-5 border-l-4 border-[#388E3C] shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-8 rounded-full bg-[#388E3C]/10 flex items-center justify-center text-[#388E3C]">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-gray-800">{label}</h3>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* English */}
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            <span className="h-5 w-5 rounded bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">EN</span>
            English
          </label>
          <div className="px-4 py-3 bg-blue-50 rounded-lg text-sm text-gray-800 min-h-[120px] whitespace-pre-wrap border border-blue-200">
            {englishValue || <span className="text-gray-400 italic">No information available</span>}
          </div>
        </div>

        {/* Bisaya */}
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            <span className="h-5 w-5 rounded bg-green-100 text-green-700 flex items-center justify-center text-[10px] font-bold">BS</span>
            Bisaya
          </label>
          <div className="px-4 py-3 bg-green-50 rounded-lg text-sm text-gray-800 min-h-[120px] whitespace-pre-wrap border border-green-200">
            {bisayaValue || <span className="text-gray-400 italic">Walay impormasyon</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Reusable field group component with enhanced UI
function FieldGroup({
  label,
  icon,
  englishValue,
  bisayaValue,
  isEditing,
  onEnglishChange,
  onBisayaChange,
}: {
  label: string;
  icon: React.ReactNode;
  englishValue: string;
  bisayaValue: string;
  isEditing: boolean;
  onEnglishChange: (value: string) => void;
  onBisayaChange: (value: string) => void;
}) {
  const hasContent = englishValue || bisayaValue;

  if (!isEditing && !hasContent) {
    return null; // Hide empty fields when not editing
  }

  return (
    <div className="bg-white rounded-lg p-5 border-l-4 border-[#388E3C] shadow-sm hover:shadow-md transition-shadow duration-200">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-8 w-8 rounded-full bg-[#388E3C]/10 flex items-center justify-center text-[#388E3C]">
          {icon}
        </div>
        <h3 className="text-base font-semibold text-gray-800">{label}</h3>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* English */}
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            <span className="h-5 w-5 rounded bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">EN</span>
            English
          </label>
          {isEditing ? (
            <textarea
              value={englishValue}
              onChange={(e) => onEnglishChange(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent text-sm min-h-[120px] resize-y transition-all duration-200 bg-white"
              placeholder={`Enter ${label.toLowerCase()} in English...`}
            />
          ) : (
            <div className="px-4 py-3 bg-blue-50 rounded-lg text-sm text-gray-800 min-h-[120px] whitespace-pre-wrap border border-blue-200">
              {englishValue || <span className="text-gray-400 italic">No information available</span>}
            </div>
          )}
        </div>

        {/* Bisaya */}
        <div>
          <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">
            <span className="h-5 w-5 rounded bg-green-100 text-green-700 flex items-center justify-center text-[10px] font-bold">BS</span>
            Bisaya
          </label>
          {isEditing ? (
            <textarea
              value={bisayaValue}
              onChange={(e) => onBisayaChange(e.target.value)}
              className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent text-sm min-h-[120px] resize-y transition-all duration-200 bg-white"
              placeholder={`Enter ${label.toLowerCase()} in Bisaya...`}
            />
          ) : (
            <div className="px-4 py-3 bg-green-50 rounded-lg text-sm text-gray-800 min-h-[120px] whitespace-pre-wrap border border-green-200">
              {bisayaValue || <span className="text-gray-400 italic">Walay impormasyon</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
