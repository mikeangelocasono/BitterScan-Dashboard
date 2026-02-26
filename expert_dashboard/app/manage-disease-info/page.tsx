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
  FileText, Stethoscope, Pill, ShieldCheck, Leaf, Search, Plus, Eye,
  Copy, AlertTriangle
} from "lucide-react";
import toast from "react-hot-toast";

// ============ UTILITY FUNCTIONS ============

/** Check if a text value is effectively empty */
function isEmptyText(value: string | null | undefined): boolean {
  return !value || value.trim() === "";
}

/** Normalize text: trim whitespace, convert empty to null */
function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Compute Bisaya translation completion status */
function computeBisayaCompletion(row: DiseaseInfo): { 
  filled: number; 
  total: number; 
  status: "missing" | "partial" | "complete" 
} {
  const biFields = [
    row.description_bi,
    row.symptoms_bi,
    row.treatment_bi,
    row.products_bi,
    row.prevention_bi,
  ];
  const filled = biFields.filter(f => !isEmptyText(f)).length;
  const total = biFields.length;
  
  let status: "missing" | "partial" | "complete";
  if (filled === 0) status = "missing";
  else if (filled === total) status = "complete";
  else status = "partial";
  
  return { filled, total, status };
}

/** Check if any Bisaya field is missing */
function hasMissingBisaya(row: DiseaseInfo): boolean {
  return computeBisayaCompletion(row).status !== "complete";
}

/** Deep compare two disease objects for changes */
function hasChanges(original: DiseaseInfo | null, current: DiseaseInfo | null): boolean {
  if (!original || !current) return false;
  const fieldsToCompare: (keyof DiseaseInfo)[] = [
    "description_en", "description_bi",
    "symptoms_en", "symptoms_bi",
    "treatment_en", "treatment_bi",
    "products_en", "products_bi",
    "prevention_en", "prevention_bi",
  ];
  return fieldsToCompare.some(field => 
    normalizeText(original[field] as string | null) !== normalizeText(current[field] as string | null)
  );
}

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
  
  // State for dirty checking
  const [originalDisease, setOriginalDisease] = useState<EditingDisease | null>(null);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);

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
        .order("updated_at", { ascending: false });

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

  // Open edit dialog - store original for dirty checking
  const openEditDialog = useCallback((disease: EditingDisease) => {
    const diseaseClone = { ...disease, isEditing: true };
    setEditingDisease(diseaseClone);
    setOriginalDisease({ ...disease, isEditing: false }); // Store original state
    setIsDialogOpen(true);
  }, []);

  // Attempt to close edit dialog - check for unsaved changes
  const attemptCloseEditDialog = useCallback(() => {
    if (hasChanges(originalDisease, editingDisease)) {
      setShowUnsavedWarning(true);
    } else {
      setIsDialogOpen(false);
      setEditingDisease(null);
      setOriginalDisease(null);
    }
  }, [originalDisease, editingDisease]);

  // Force close edit dialog (after user confirms)
  const forceCloseEditDialog = useCallback(() => {
    setShowUnsavedWarning(false);
    setIsDialogOpen(false);
    setEditingDisease(null);
    setOriginalDisease(null);
  }, []);

  // Close edit dialog (legacy - for successful saves)
  const closeEditDialog = useCallback(() => {
    setShowUnsavedWarning(false);
    setIsDialogOpen(false);
    setEditingDisease(null);
    setOriginalDisease(null);
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

  // Copy English to Bisaya for a specific field pair
  const copyEnToBi = useCallback((enField: keyof DiseaseInfo, biField: keyof DiseaseInfo) => {
    if (!editingDisease) return;
    const enValue = editingDisease[enField] as string | null;
    if (enValue) {
      setEditingDisease(prev => prev ? { ...prev, [biField]: enValue } : prev);
      toast.success(`Copied to Bisaya`);
    } else {
      toast.error("No English content to copy");
    }
  }, [editingDisease]);

  // Copy all English fields to Bisaya
  const copyAllEnToBi = useCallback(() => {
    if (!editingDisease) return;
    const updates: Partial<DiseaseInfo> = {};
    let copiedCount = 0;
    
    const pairs: [keyof DiseaseInfo, keyof DiseaseInfo][] = [
      ["description_en", "description_bi"],
      ["symptoms_en", "symptoms_bi"],
      ["treatment_en", "treatment_bi"],
      ["products_en", "products_bi"],
      ["prevention_en", "prevention_bi"],
    ];
    
    for (const [en, bi] of pairs) {
      const enValue = editingDisease[en] as string | null;
      if (enValue && !isEmptyText(enValue)) {
        updates[bi] = enValue;
        copiedCount++;
      }
    }
    
    if (copiedCount > 0) {
      setEditingDisease(prev => prev ? { ...prev, ...updates } : prev);
      toast.success(`Copied ${copiedCount} field(s) to Bisaya`);
    } else {
      toast.error("No English content to copy");
    }
  }, [editingDisease]);

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

  // Save disease information with concurrency check
  const saveDisease = useCallback(async (disease: EditingDisease, forceOverwrite = false) => {
    if (savingId) return; // Prevent multiple simultaneous saves

    // Check if there are any changes
    if (!hasChanges(originalDisease, disease)) {
      toast("No changes to save");
      closeEditDialog();
      return;
    }

    setSavingId(disease.disease_id);
    try {
      // 1. Fetch existing record to compare and check concurrency
      const { data: existing, error: fetchError } = await supabase
        .from("disease_info")
        .select("*")
        .eq("disease_id", disease.disease_id)
        .single();

      if (fetchError || !existing) {
        console.error("Error fetching existing disease record:", fetchError);
        toast.error("Disease record not found. It may have been deleted.");
        setSavingId(null);
        return;
      }

      // 2. Concurrency check - warn if record was modified by someone else
      if (!forceOverwrite && originalDisease?.updated_at && existing.updated_at) {
        const originalTime = new Date(originalDisease.updated_at).getTime();
        const serverTime = new Date(existing.updated_at).getTime();
        if (serverTime > originalTime) {
          const confirmOverwrite = window.confirm(
            "This disease was updated by another user while you were editing. Do you want to overwrite their changes?"
          );
          if (!confirmOverwrite) {
            setSavingId(null);
            return;
          }
        }
      }

      // 3. Build update payload with normalized values
      const updatePayload: Record<string, string | null> = {
        description_en: normalizeText(disease.description_en),
        description_bi: normalizeText(disease.description_bi),
        symptoms_en: normalizeText(disease.symptoms_en),
        symptoms_bi: normalizeText(disease.symptoms_bi),
        treatment_en: normalizeText(disease.treatment_en),
        treatment_bi: normalizeText(disease.treatment_bi),
        products_en: normalizeText(disease.products_en),
        products_bi: normalizeText(disease.products_bi),
        prevention_en: normalizeText(disease.prevention_en),
        prevention_bi: normalizeText(disease.prevention_bi),
      };

      // 4. Check if English content changed - if so, warn that Bisaya may need update
      for (const [enField, biField] of enBiFieldPairs) {
        const oldEn = normalize(existing[enField] as string | null);
        const newEn = normalize(disease[enField] as string | null);
        if (oldEn !== newEn && updatePayload[biField]) {
          // English changed but Bisaya wasn't cleared - that's fine, user explicitly set it
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
        // Handle specific error types
        if (error.code === "23505") {
          toast.error("A disease with this name already exists");
        } else if (error.code === "42501") {
          toast.error("You don't have permission to update this record");
        } else {
          toast.error(`Failed to save ${disease.disease_name}`);
        }
        return;
      }

      toast.success(`${disease.disease_name} updated successfully`);
      toggleEdit(disease.disease_id);
      closeEditDialog();
      await fetchDiseases(); // Refresh data
    } catch (err) {
      console.error("Unexpected error saving disease:", err);
      toast.error("Failed to save changes. Please try again.");
    } finally {
      setSavingId(null);
    }
  }, [savingId, toggleEdit, fetchDiseases, closeEditDialog, user?.id, normalize, enBiFieldPairs, originalDisease]);

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
          <div className="flex flex-col gap-4">
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
                      <div className="text-sm text-gray-700">
                        English/Bisaya
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
        if (!open) attemptCloseEditDialog();
      }}>
        <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="bg-gradient-to-r from-[#388E3C] to-[#2F7A33] px-6 py-5 border-b-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-bold text-white flex items-center gap-3">
                <Edit2 className="h-6 w-6" />
                Edit {editingDisease?.disease_name}
              </DialogTitle>
              <button
                onClick={attemptCloseEditDialog}
                className="text-white/80 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
                title="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </DialogHeader>
          <DialogContent className="overflow-y-auto flex-1 p-6">
            {editingDisease && (
              <div className="space-y-5">
                {/* Copy All Button */}
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={copyAllEnToBi}
                    className="text-sm border-[#388E3C] text-[#388E3C] hover:bg-[#388E3C]/10"
                  >
                    <Copy className="h-4 w-4 mr-2" />
                    Copy All EN → BS
                  </Button>
                </div>
                
                <FieldGroup
                  label="Description"
                  icon={<FileText className="h-4 w-4" />}
                  englishValue={editingDisease.description_en || ""}
                  bisayaValue={editingDisease.description_bi || ""}
                  isEditing={true}
                  onEnglishChange={(val) => setEditingDisease(prev => prev ? { ...prev, description_en: val } : prev)}
                  onBisayaChange={(val) => setEditingDisease(prev => prev ? { ...prev, description_bi: val } : prev)}
                  onCopyEnToBi={() => copyEnToBi("description_en", "description_bi")}
                />
                <FieldGroup
                  label="Symptoms"
                  icon={<Stethoscope className="h-4 w-4" />}
                  englishValue={editingDisease.symptoms_en || ""}
                  bisayaValue={editingDisease.symptoms_bi || ""}
                  isEditing={true}
                  onEnglishChange={(val) => setEditingDisease(prev => prev ? { ...prev, symptoms_en: val } : prev)}
                  onBisayaChange={(val) => setEditingDisease(prev => prev ? { ...prev, symptoms_bi: val } : prev)}
                  onCopyEnToBi={() => copyEnToBi("symptoms_en", "symptoms_bi")}
                />
                <FieldGroup
                  label="Treatment"
                  icon={<Pill className="h-4 w-4" />}
                  englishValue={editingDisease.treatment_en || ""}
                  bisayaValue={editingDisease.treatment_bi || ""}
                  isEditing={true}
                  onEnglishChange={(val) => setEditingDisease(prev => prev ? { ...prev, treatment_en: val } : prev)}
                  onBisayaChange={(val) => setEditingDisease(prev => prev ? { ...prev, treatment_bi: val } : prev)}
                  onCopyEnToBi={() => copyEnToBi("treatment_en", "treatment_bi")}
                />
                <FieldGroup
                  label="Products"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  englishValue={editingDisease.products_en || ""}
                  bisayaValue={editingDisease.products_bi || ""}
                  isEditing={true}
                  onEnglishChange={(val) => setEditingDisease(prev => prev ? { ...prev, products_en: val } : prev)}
                  onBisayaChange={(val) => setEditingDisease(prev => prev ? { ...prev, products_bi: val } : prev)}
                  onCopyEnToBi={() => copyEnToBi("products_en", "products_bi")}
                />
                <FieldGroup
                  label="Prevention"
                  icon={<ShieldCheck className="h-4 w-4" />}
                  englishValue={editingDisease.prevention_en || ""}
                  bisayaValue={editingDisease.prevention_bi || ""}
                  isEditing={true}
                  onEnglishChange={(val) => setEditingDisease(prev => prev ? { ...prev, prevention_en: val } : prev)}
                  onBisayaChange={(val) => setEditingDisease(prev => prev ? { ...prev, prevention_bi: val } : prev)}
                  onCopyEnToBi={() => copyEnToBi("prevention_en", "prevention_bi")}
                />
              </div>
            )}
          </DialogContent>
          <DialogFooter className="bg-gray-50 px-6 py-4">
            <Button
              variant="outline"
              onClick={attemptCloseEditDialog}
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
              disabled={savingId === editingDisease?.disease_id || !hasChanges(originalDisease, editingDisease)}
              className="bg-[#388E3C] hover:bg-[#2F7A33] text-white disabled:opacity-50"
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

      {/* Unsaved Changes Warning Dialog */}
      <Dialog open={showUnsavedWarning} onOpenChange={setShowUnsavedWarning}>
        <div className="bg-white rounded-xl max-w-md w-full overflow-hidden">
          <DialogHeader className="px-6 py-5 border-b">
            <DialogTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Unsaved Changes
            </DialogTitle>
          </DialogHeader>
          <DialogContent className="px-6 py-4">
            <p className="text-gray-600">
              You have unsaved changes. Are you sure you want to close without saving?
            </p>
          </DialogContent>
          <DialogFooter className="bg-gray-50 px-6 py-4">
            <Button
              variant="outline"
              onClick={() => setShowUnsavedWarning(false)}
              className="border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              Keep Editing
            </Button>
            <Button
              onClick={forceCloseEditDialog}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              Discard Changes
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

// Reusable field group component with enhanced UI and Copy button
function FieldGroup({
  label,
  icon,
  englishValue,
  bisayaValue,
  isEditing,
  onEnglishChange,
  onBisayaChange,
  onCopyEnToBi,
}: {
  label: string;
  icon: React.ReactNode;
  englishValue: string;
  bisayaValue: string;
  isEditing: boolean;
  onEnglishChange: (value: string) => void;
  onBisayaChange: (value: string) => void;
  onCopyEnToBi?: () => void;
}) {
  const hasContent = englishValue || bisayaValue;

  if (!isEditing && !hasContent) {
    return null; // Hide empty fields when not editing
  }

  return (
    <div className="bg-white rounded-lg p-5 border-l-4 border-[#388E3C] shadow-sm hover:shadow-md transition-shadow duration-200">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-[#388E3C]/10 flex items-center justify-center text-[#388E3C]">
            {icon}
          </div>
          <h3 className="text-base font-semibold text-gray-800">{label}</h3>
        </div>
        {isEditing && onCopyEnToBi && (
          <button
            type="button"
            onClick={onCopyEnToBi}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#388E3C] hover:bg-[#388E3C]/10 rounded transition-colors"
            title={`Copy English ${label} to Bisaya`}
          >
            <Copy className="h-3 w-3" />
            EN → BS
          </button>
        )}
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
