"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/components/supabase";
import { useUser } from "@/components/UserContext";
import { 
  Loader2, Save, BookOpen, CheckCircle2, Edit2, X, 
  FileText, Stethoscope, Pill, ShieldCheck, Leaf, Search, Eye,
  AlertTriangle
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
  const [translatingField, setTranslatingField] = useState<string | null>(null);

  const effectiveRole = useMemo(() => profile?.role || user?.user_metadata?.role || null, [profile?.role, user?.user_metadata?.role]);
  const isAuthorized = useMemo(() => effectiveRole === "expert" || effectiveRole === "admin", [effectiveRole]);

  // Redirect unauthorized users - only after session AND profile are fully loaded
  useEffect(() => {
    if (sessionReady && !userLoading && user && profile && !isAuthorized) {
      toast.error("Access denied. Experts and Admins only.");
      router.replace("/dashboard");
    }
  }, [sessionReady, userLoading, user, profile, isAuthorized, router]);

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

  // Filter diseases based on search query (name, description, symptoms, treatment)
  const filteredDiseases = useMemo(() => {
    if (!searchQuery.trim()) return diseases;
    const query = searchQuery.toLowerCase();
    return diseases.filter(disease => {
      const nameMatch = disease.disease_name.toLowerCase().includes(query);
      const descEnMatch = (disease.description_en || "").toLowerCase().includes(query);
      const descBiMatch = (disease.description_bi || "").toLowerCase().includes(query);
      const symEnMatch = (disease.symptoms_en || "").toLowerCase().includes(query);
      const symBiMatch = (disease.symptoms_bi || "").toLowerCase().includes(query);
      const treatEnMatch = (disease.treatment_en || "").toLowerCase().includes(query);
      const treatBiMatch = (disease.treatment_bi || "").toLowerCase().includes(query);
      return nameMatch || descEnMatch || descBiMatch || symEnMatch || symBiMatch || treatEnMatch || treatBiMatch;
    });
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

  // Translation handler — calls /api/translate securely
  const handleTranslate = useCallback(async (
    fieldLabel: string,
    direction: 'en-to-bi' | 'bi-to-en',
    sourceText: string,
    onResult: (translatedText: string) => void
  ) => {
    if (!sourceText.trim()) {
      toast.error("No text to translate");
      return;
    }

    const fieldKey = `${fieldLabel}-${direction}`;
    setTranslatingField(fieldKey);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Session expired. Please log in again.");
        return;
      }

      const from = direction === 'en-to-bi' ? 'en' : 'ceb';
      const to = direction === 'en-to-bi' ? 'ceb' : 'en';

      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ text: sourceText.trim(), from, to }),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        throw new Error(errorBody.error || `Translation failed (${res.status})`);
      }

      const { translatedText } = await res.json();
      if (translatedText) {
        onResult(translatedText);
        toast.success(`Translated to ${direction === 'en-to-bi' ? 'Bisaya' : 'English'}`);
      } else {
        toast.error("Translation returned empty result");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Translation failed";
      toast.error(msg);
      console.error("[Translation]", err);
    } finally {
      setTranslatingField(null);
    }
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Disease Information</h2>
          <p className="text-sm text-gray-500 mt-0.5">Manage bilingual disease information, symptoms, and treatment recommendations.</p>
        </div>
      </div>

      {/* Search and Actions Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search disease name, symptoms, or treatment..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-all shadow-sm"
          />
        </div>
      </div>

      {/* Disease Database Section */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Green Header */}
        <div className="px-5 sm:px-6 py-4 bg-gradient-to-r from-[#388E3C] to-[#2F7A33]">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold !text-white">Disease Database</h3>
              <p className="text-xs !text-white/80 mt-0.5">Manage disease information in English and Bisaya.</p>
            </div>
            <div className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center">
              <BookOpen className="h-4 w-4 text-white" />
            </div>
          </div>
        </div>

        {/* Table */}
        {filteredDiseases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="h-10 w-10 text-gray-300 mb-3" />
            <p className="text-gray-500 font-medium text-sm">
              {searchQuery ? "No matching diseases found" : "No Disease Information Available"}
            </p>
            <p className="text-gray-400 text-xs mt-1 max-w-sm">
              {searchQuery
                ? "Try adjusting your search query"
                : "Disease data will appear here once added to the database."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50/80 border-b border-gray-100">
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Disease Name</th>
                  <th className="px-5 py-3 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Languages</th>
                  <th className="px-5 py-3 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredDiseases.map((disease) => {
                  const biStatus = computeBisayaCompletion(disease);
                  return (
                    <tr key={disease.disease_id} className="hover:bg-gray-50/60 transition-colors duration-150">
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                            <Leaf className="h-4 w-4 text-[#388E3C]" />
                          </div>
                          <span className="text-sm font-medium text-gray-900">{disease.disease_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className="text-xs text-gray-600">English/Bisaya</span>
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openViewDialog(disease)}
                            className="p-1.5 text-gray-400 hover:text-[#388E3C] hover:bg-emerald-50 rounded-lg transition-all duration-150"
                            title="View Details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openEditDialog(disease)}
                            className="p-1.5 text-gray-400 hover:text-[#388E3C] hover:bg-emerald-50 rounded-lg transition-all duration-150"
                            title="Edit"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* View Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={(open) => {
        if (!open) closeViewDialog();
      }} maxWidthClass="sm:max-w-3xl md:max-w-3xl">
        <DialogContent className="w-full p-0 flex flex-col max-h-[90vh] h-auto overflow-hidden bg-white rounded-2xl shadow-2xl border-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] flex-shrink-0">
            <DialogHeader className="p-0">
              <DialogTitle className="text-lg sm:text-xl font-bold !text-white flex items-center gap-2.5">
                <BookOpen className="h-5 w-5" />
                {viewingDisease?.disease_name}
              </DialogTitle>
              <p className="text-xs !text-white/80 mt-0.5">Bilingual disease information and recommended management guide.</p>
            </DialogHeader>
            <button
              onClick={closeViewDialog}
              className="rounded-lg p-2 bg-white/20 hover:bg-white/30 text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto bg-gray-50/40 px-5 sm:px-6 py-5">
            {viewingDisease && (
              <div className="space-y-4">
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
          </div>

          {/* Footer */}
          <div className="bg-white border-t border-gray-100 px-5 sm:px-6 py-3.5 flex-shrink-0">
            <DialogFooter className="flex items-center justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={closeViewDialog}
                className="h-9 text-sm font-medium text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900 transition-all"
              >
                Close
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => {
        if (!open) attemptCloseEditDialog();
      }} maxWidthClass="sm:max-w-4xl md:max-w-4xl">
        <DialogContent className="w-full p-0 flex flex-col max-h-[92vh] h-auto overflow-hidden bg-white rounded-2xl shadow-2xl border-0">
          {/* Header */}
          <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] flex-shrink-0">
            <DialogHeader className="p-0">
              <DialogTitle className="text-lg sm:text-xl font-bold !text-white flex items-center gap-2.5">
                <Edit2 className="h-5 w-5" />
                Edit {editingDisease?.disease_name}
              </DialogTitle>
              <p className="text-xs !text-white/80 mt-0.5">Update bilingual disease information, symptoms, and treatment recommendations.</p>
            </DialogHeader>
            <button
              onClick={attemptCloseEditDialog}
              className="rounded-lg p-2 bg-white/20 hover:bg-white/30 text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
              aria-label="Close"
              title="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto bg-gray-50/40 px-5 sm:px-6 py-5">
            {editingDisease && (
              <div className="space-y-4">
                <FieldGroup
                  label="Description"
                  icon={<FileText className="h-4 w-4" />}
                  englishValue={editingDisease.description_en || ""}
                  bisayaValue={editingDisease.description_bi || ""}
                  onEnglishChange={(val) => setEditingDisease(prev => prev ? { ...prev, description_en: val } : prev)}
                  onBisayaChange={(val) => setEditingDisease(prev => prev ? { ...prev, description_bi: val } : prev)}
                  translatingField={translatingField}
                  onTranslate={(dir) => handleTranslate("Description", dir, dir === 'en-to-bi' ? (editingDisease.description_en || '') : (editingDisease.description_bi || ''), (text) => setEditingDisease(prev => prev ? { ...prev, [dir === 'en-to-bi' ? 'description_bi' : 'description_en']: text } : prev))}
                />
                <FieldGroup
                  label="Symptoms"
                  icon={<Stethoscope className="h-4 w-4" />}
                  englishValue={editingDisease.symptoms_en || ""}
                  bisayaValue={editingDisease.symptoms_bi || ""}
                  onEnglishChange={(val) => setEditingDisease(prev => prev ? { ...prev, symptoms_en: val } : prev)}
                  onBisayaChange={(val) => setEditingDisease(prev => prev ? { ...prev, symptoms_bi: val } : prev)}
                  translatingField={translatingField}
                  onTranslate={(dir) => handleTranslate("Symptoms", dir, dir === 'en-to-bi' ? (editingDisease.symptoms_en || '') : (editingDisease.symptoms_bi || ''), (text) => setEditingDisease(prev => prev ? { ...prev, [dir === 'en-to-bi' ? 'symptoms_bi' : 'symptoms_en']: text } : prev))}
                />
                <FieldGroup
                  label="Treatment"
                  icon={<Pill className="h-4 w-4" />}
                  englishValue={editingDisease.treatment_en || ""}
                  bisayaValue={editingDisease.treatment_bi || ""}
                  onEnglishChange={(val) => setEditingDisease(prev => prev ? { ...prev, treatment_en: val } : prev)}
                  onBisayaChange={(val) => setEditingDisease(prev => prev ? { ...prev, treatment_bi: val } : prev)}
                  translatingField={translatingField}
                  onTranslate={(dir) => handleTranslate("Treatment", dir, dir === 'en-to-bi' ? (editingDisease.treatment_en || '') : (editingDisease.treatment_bi || ''), (text) => setEditingDisease(prev => prev ? { ...prev, [dir === 'en-to-bi' ? 'treatment_bi' : 'treatment_en']: text } : prev))}
                />
                <FieldGroup
                  label="Products"
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  englishValue={editingDisease.products_en || ""}
                  bisayaValue={editingDisease.products_bi || ""}
                  onEnglishChange={(val) => setEditingDisease(prev => prev ? { ...prev, products_en: val } : prev)}
                  onBisayaChange={(val) => setEditingDisease(prev => prev ? { ...prev, products_bi: val } : prev)}
                  translatingField={translatingField}
                  onTranslate={(dir) => handleTranslate("Products", dir, dir === 'en-to-bi' ? (editingDisease.products_en || '') : (editingDisease.products_bi || ''), (text) => setEditingDisease(prev => prev ? { ...prev, [dir === 'en-to-bi' ? 'products_bi' : 'products_en']: text } : prev))}
                />
                <FieldGroup
                  label="Prevention"
                  icon={<ShieldCheck className="h-4 w-4" />}
                  englishValue={editingDisease.prevention_en || ""}
                  bisayaValue={editingDisease.prevention_bi || ""}
                  onEnglishChange={(val) => setEditingDisease(prev => prev ? { ...prev, prevention_en: val } : prev)}
                  onBisayaChange={(val) => setEditingDisease(prev => prev ? { ...prev, prevention_bi: val } : prev)}
                  translatingField={translatingField}
                  onTranslate={(dir) => handleTranslate("Prevention", dir, dir === 'en-to-bi' ? (editingDisease.prevention_en || '') : (editingDisease.prevention_bi || ''), (text) => setEditingDisease(prev => prev ? { ...prev, [dir === 'en-to-bi' ? 'prevention_bi' : 'prevention_en']: text } : prev))}
                />
              </div>
            )}
          </div>

          {/* Sticky Footer */}
          <div className="bg-white border-t border-gray-100 px-5 sm:px-6 py-3.5 flex-shrink-0">
            <DialogFooter className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={attemptCloseEditDialog}
                disabled={savingId === editingDisease?.disease_id}
                className="h-9 text-sm font-medium text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900 transition-all"
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
              <Button
                size="sm"
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
                className="h-9 text-sm font-semibold bg-[#388E3C] text-white hover:bg-[#2F7A33] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all"
              >
                {savingId === editingDisease?.disease_id ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    Save Changes
                  </>
                )}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Warning Dialog */}
      <Dialog open={showUnsavedWarning} onOpenChange={setShowUnsavedWarning} maxWidthClass="sm:max-w-sm">
        <DialogContent className="w-full p-0 flex flex-col overflow-hidden bg-white rounded-xl shadow-2xl border-0">
          <DialogHeader className="px-5 sm:px-6 py-4 border-b border-gray-100">
            <DialogTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Unsaved Changes
            </DialogTitle>
          </DialogHeader>
          <div className="px-5 sm:px-6 py-4">
            <p className="text-sm text-gray-600">
              You have unsaved changes. Are you sure you want to close without saving?
            </p>
          </div>
          <DialogFooter className="bg-gray-50/60 px-5 sm:px-6 py-3.5 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowUnsavedWarning(false)}
              className="h-9 text-sm font-medium text-gray-600 border-gray-200 hover:bg-gray-50 transition-all"
            >
              Keep Editing
            </Button>
            <Button
              size="sm"
              onClick={forceCloseEditDialog}
              className="h-9 text-sm font-semibold bg-red-500 text-white hover:bg-red-600 shadow-sm transition-all"
            >
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
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
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-7 w-7 rounded-lg bg-emerald-50 flex items-center justify-center text-[#388E3C]">
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-gray-800">{label}</h3>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* English */}
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">
            <span className="h-4 w-4 rounded bg-blue-50 text-blue-600 flex items-center justify-center text-[9px] font-bold border border-blue-100">EN</span>
            English
          </label>
          <div className="px-3 py-2.5 bg-slate-50 rounded-lg text-sm text-gray-700 whitespace-pre-wrap border border-slate-100 min-h-[80px]">
            {englishValue || <span className="text-gray-400 italic text-xs">No information available</span>}
          </div>
        </div>

        {/* Bisaya */}
        <div>
          <label className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500 mb-1.5 uppercase tracking-wider">
            <span className="h-4 w-4 rounded bg-emerald-50 text-emerald-600 flex items-center justify-center text-[9px] font-bold border border-emerald-100">BS</span>
            Bisaya
          </label>
          <div className="px-3 py-2.5 bg-emerald-50/40 rounded-lg text-sm text-gray-700 whitespace-pre-wrap border border-emerald-100/60 min-h-[80px]">
            {bisayaValue || <span className="text-gray-400 italic text-xs">Walay impormasyon</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Reusable field group component for edit modal with translation support
function FieldGroup({
  label,
  icon,
  englishValue,
  bisayaValue,
  onEnglishChange,
  onBisayaChange,
  onTranslate,
  translatingField,
}: {
  label: string;
  icon: React.ReactNode;
  englishValue: string;
  bisayaValue: string;
  onEnglishChange: (value: string) => void;
  onBisayaChange: (value: string) => void;
  onTranslate?: (direction: 'en-to-bi' | 'bi-to-en') => void;
  translatingField?: string | null;
}) {
  const isTranslatingEnToBi = translatingField === `${label}-en-to-bi`;
  const isTranslatingBiToEn = translatingField === `${label}-bi-to-en`;

  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-7 w-7 rounded-lg bg-emerald-50 flex items-center justify-center text-[#388E3C]">
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-gray-800">{label}</h3>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* English */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              <span className="h-4 w-4 rounded bg-blue-50 text-blue-600 flex items-center justify-center text-[9px] font-bold border border-blue-100">EN</span>
              English
            </label>
            {onTranslate && bisayaValue.trim() && (
              <button
                type="button"
                onClick={() => onTranslate('bi-to-en')}
                disabled={!!translatingField}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-blue-600 bg-blue-50 border border-blue-100 rounded-md hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                title="Translate Bisaya → English"
              >
                {isTranslatingBiToEn ? (
                  <><span className="h-3 w-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" /> Translating...</>
                ) : (
                  <>← Translate from BS</>
                )}
              </button>
            )}
          </div>
          <textarea
            value={englishValue}
            onChange={(e) => onEnglishChange(e.target.value)}
            className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-[#388E3C] text-sm text-gray-800 min-h-[100px] resize-y placeholder:text-gray-300 transition-all"
            placeholder={`Enter ${label.toLowerCase()} in English...`}
            rows={4}
          />
          <p className="text-[10px] text-gray-400 mt-1 text-right">{englishValue.length} characters</p>
        </div>

        {/* Bisaya */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              <span className="h-4 w-4 rounded bg-emerald-50 text-emerald-600 flex items-center justify-center text-[9px] font-bold border border-emerald-100">BS</span>
              Bisaya
            </label>
            {onTranslate && englishValue.trim() && (
              <button
                type="button"
                onClick={() => onTranslate('en-to-bi')}
                disabled={!!translatingField}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-md hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                title="Translate English → Bisaya"
              >
                {isTranslatingEnToBi ? (
                  <><span className="h-3 w-3 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" /> Translating...</>
                ) : (
                  <>← Translate from EN</>
                )}
              </button>
            )}
          </div>
          <textarea
            value={bisayaValue}
            onChange={(e) => onBisayaChange(e.target.value)}
            className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-[#388E3C] text-sm text-gray-800 min-h-[100px] resize-y placeholder:text-gray-300 transition-all"
            placeholder={`Enter ${label.toLowerCase()} in Bisaya...`}
            rows={4}
          />
          <p className="text-[10px] text-gray-400 mt-1 text-right">{bisayaValue.length} characters</p>
        </div>
      </div>
    </div>
  );
}
