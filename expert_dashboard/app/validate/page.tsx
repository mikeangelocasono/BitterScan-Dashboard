"use client";

import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import React, { useMemo, useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/components/supabase";
import { Loader2, AlertCircle, X, Eye, Calendar, User, ScanLine, CheckCircle2, Activity, ClipboardCheck, ExternalLink, ShieldCheck, ZoomIn, Download, Lightbulb, Maximize2 } from "lucide-react";
import Pagination from "@/components/ui/pagination";
import { Scan, SupabaseApiError, isSupabaseApiError, getAiPrediction, getSolution, getRecommendedProducts } from "@/types";
import { useUser } from "@/components/UserContext";
import { useData } from "@/components/DataContext";
import Image from "next/image";
import { getScanImageUrlWithFallback, getAllPossibleImageUrls } from "@/utils/imageUtils";
import { formatDate, getDateRange } from "@/utils/dateUtils";

// Type for error logging data
type ErrorLogData = Record<string, string | number | null | undefined | string[]> | null | undefined;

// Type for Supabase leaf disease scan response
type LeafDiseaseScanResponse = {
	disease_detected: string;
} | null;

// Type for Supabase fruit ripeness scan response
type FruitRipenessScanResponse = {
	ripeness_stage: string;
} | null;

// Type for Supabase update response
type SupabaseUpdateResponse = {
	error: unknown | null;
};

// Type for console.log debug object
type DebugLogObject = {
	detailId: string | null;
	scan_id: number;
	scan_uuid: string;
	scan_type: 'leaf_disease' | 'fruit_maturity';
	imageUrl: string | null;
	hasImageUrl: boolean;
};

// Error throttling to prevent console spam
// Track errors silently - only log once per unique image error
const errorThrottle = new Map<string, boolean>();

// Pagination constants
const PAGE_SIZE = 5;

const throttledErrorLog = (key: string, message: string, data?: ErrorLogData) => {
	// Only log each unique error once per page session
	if (!errorThrottle.has(key)) {
		errorThrottle.set(key, true);
		// Use console.warn instead of console.error for expected errors (missing images)
		// This prevents Next.js error handling from treating it as a critical error
		if (process.env.NODE_ENV === 'development') {
			if (data) {
				console.warn(message, data);
			} else {
				console.warn(message);
			}
		}
	}
};


/**
 * Safely extract error details for logging
 * This ensures error objects are properly serialized and always returns full details
 */
const extractErrorDetails = (error: unknown): Record<string, string | number | null> => {
	if (!error) {
		return { 
			message: "Unknown error", 
			code: null,
			details: null,
			hint: null,
			status: null,
			errorType: "null" 
		};
	}

	// If it's a Supabase API error (PostgrestError, AuthApiError, etc.)
	if (isSupabaseApiError(error)) {
		// Extract all possible properties from Supabase error
		// Extended interface to handle all Supabase error variants
		interface ExtendedSupabaseError extends SupabaseApiError {
			error_description?: string;
			error_code?: string;
		}
		const supabaseError = error as ExtendedSupabaseError;
		return {
			message: supabaseError.message || supabaseError.error_description || "No message",
			code: supabaseError.code || supabaseError.error_code || null,
			details: supabaseError.details || null,
			hint: supabaseError.hint || null,
			status: supabaseError.status ? String(supabaseError.status) : null,
			errorType: "SupabaseApiError",
		};
	}

	// If it's a standard Error object
	if (error instanceof Error) {
		return {
			message: error.message || "No message",
			name: error.name || "Error",
			stack: error.stack ? error.stack.substring(0, 500) : null, // Limit stack trace length
			code: null,
			details: null,
			hint: null,
			status: null,
			errorType: "Error",
		};
	}

	// Try to stringify if it's an object
	if (typeof error === 'object' && error !== null) {
		try {
			// Try to extract common error properties first
			// Define interface for generic error objects
			interface GenericErrorObject {
				message?: string;
				error?: string;
				code?: string | number;
				details?: string;
				hint?: string;
				status?: string | number;
			}
			// Type guard to safely narrow the type - use Record for safer type narrowing
			const errorRecord = error as Record<string, unknown>;
			const errorObj: GenericErrorObject = {
				message: typeof errorRecord.message === 'string' ? errorRecord.message : undefined,
				error: typeof errorRecord.error === 'string' ? errorRecord.error : undefined,
				code: (typeof errorRecord.code === 'string' || typeof errorRecord.code === 'number') ? errorRecord.code : undefined,
				details: typeof errorRecord.details === 'string' ? errorRecord.details : undefined,
				hint: typeof errorRecord.hint === 'string' ? errorRecord.hint : undefined,
				status: (typeof errorRecord.status === 'string' || typeof errorRecord.status === 'number') ? errorRecord.status : undefined,
			};
			const extracted: Record<string, string | number | null> = {
				message: errorObj.message || errorObj.error || "Non-standard error object",
				code: (errorObj.code !== undefined) ? errorObj.code : null,
				details: errorObj.details || null,
				hint: errorObj.hint || null,
				status: (errorObj.status !== undefined) ? String(errorObj.status) : null,
				errorType: "Object",
			};
			
			// If we have a meaningful message, return it; otherwise stringify
			if (extracted.message !== "Non-standard error object") {
				return extracted;
			}
			
			const stringified = JSON.stringify(error);
			return {
				...extracted,
				message: "Non-standard error object",
				errorString: stringified.length > 500 ? stringified.substring(0, 500) + "..." : stringified,
			};
		} catch (err: unknown) {
			return {
				message: "Error object could not be serialized",
				errorString: String(err),
				code: null,
				details: null,
				hint: null,
				status: null,
				errorType: "UnserializableObject",
			};
		}
	}

	// Fallback for primitive types
	// Type guard to safely get the type of error as a string
	const errorTypeName: string = typeof error === 'string' 
		? 'string' 
		: typeof error === 'number' 
		? 'number' 
		: typeof error === 'boolean' 
		? 'boolean' 
		: typeof error === 'undefined' 
		? 'undefined' 
		: typeof error === 'function' 
		? 'function' 
		: typeof error === 'symbol' 
		? 'symbol' 
		: typeof error === 'bigint' 
		? 'bigint' 
		: 'unknown';
	
	return {
		message: String(error),
		errorString: String(error),
		code: null,
		details: null,
		hint: null,
		status: null,
		errorType: errorTypeName,
	};
};

/**
 * Validate Page - Real-Time Scan Validation
 * 
 * This page automatically displays new scans in real-time without requiring page refresh.
 * 
 * REAL-TIME FUNCTIONALITY:
 * - New scans with status='Pending Validation' appear automatically via Supabase Realtime
 * - When a scan is marked as Confirmed or Corrected, it disappears immediately
 * - All updates happen instantly through DataContext real-time subscriptions
 * - No manual refresh needed - UI updates automatically
 * 
 * IMPORTANT VALIDATION LOGIC:
 * - Both "Confirm" and "Correct" actions set scans.status to "Validated"
 * - The validation_history table tracks whether it was "Validated" or "Corrected" for AI accuracy
 * - This ensures all validated scans are counted correctly in reports and analytics
 * 
 * How it works:
 * 1. DataContext subscribes to Supabase Realtime events (INSERT/UPDATE on 'scans' table)
 * 2. When a new scan is inserted with status='Pending Validation', it's added to the scans state
 * 3. This page filters scans for status='Pending Validation' and displays them
 * 4. When a scan is validated/corrected, its status changes to 'Validated' (both actions)
 * 5. The filter automatically excludes non-pending scans, so they disappear from the list
 * 
 * The filtered array is memoized to prevent unnecessary re-renders when unrelated state changes.
 */
export default function ValidatePage() {
	const [tab, setTab] = useState<'leaf' | 'fruit'>('leaf');
	const [notes, setNotes] = useState<Record<string, string>>({});
	const [decision, setDecision] = useState<Record<string, string>>({});
	const [dateRangeType, setDateRangeType] = useState<'daily' | 'weekly' | 'monthly' | 'custom' | 'none'>('none');
	const [startDate, setStartDate] = useState<string>("");
	const [endDate, setEndDate] = useState<string>("");
	const [detailId, setDetailId] = useState<string | null>(null);
	const [processingScanId, setProcessingScanId] = useState<number | null>(null);
	// Track image URL attempts per scan to try multiple extensions
	const [imageUrlAttempts, setImageUrlAttempts] = useState<Record<string, number>>({});
	// Force render after timeout to prevent infinite loading
	const [forceRender, setForceRender] = useState(false);
	// Pagination state
	const [currentPage, setCurrentPage] = useState(1);
	const { user, profile } = useUser();
	// Get scans from DataContext - these update automatically via Supabase Realtime subscriptions
	const { scans, loading, error, removeScanFromState, updateScanStatusInState, refreshData } = useData();

	// Master timeout: force render after 1 second to prevent infinite loading
	useEffect(() => {
		const timeout = setTimeout(() => {
			if (!forceRender && loading) {
				console.warn('[ValidatePage] Forcing render after timeout');
				setForceRender(true);
			}
		}, 1000);
		return () => clearTimeout(timeout);
	}, [forceRender, loading]);

	// Debug: Log when selected scan changes (development only)
	useEffect(() => {
		if (process.env.NODE_ENV === 'development' && detailId) {
			const selectedScan = scans.find((scan: Scan) => scan.id.toString() === detailId);
			if (selectedScan) {
				const imageUrl = getScanImageUrlWithFallback(selectedScan);
				const debugLog: DebugLogObject = {
					detailId,
					scan_id: selectedScan.id,
					scan_uuid: selectedScan.scan_uuid,
					scan_type: selectedScan.scan_type,
					imageUrl,
					hasImageUrl: !!imageUrl
				};
				console.log('[Validate Page] Selected scan changed:', debugLog);
			}
		}
	}, [detailId, scans]);

	// Set default dropdown value when a scan is selected
	useEffect(() => {
		if (detailId) {
			const selectedScan = scans.find((scan: Scan) => scan.id.toString() === detailId);
			if (selectedScan && !decision[detailId]) {
				// Get the default value from database (disease_detected or ripeness_stage)
				const defaultValue = getAiPrediction(selectedScan);
				if (defaultValue) {
					setDecision((prev: Record<string, string>) => ({
						...prev,
						[detailId]: defaultValue
					}));
				}
			}
		}
	}, [detailId, scans, decision]);

	// Prevent body scroll when modal is open
	useEffect(() => {
		if (detailId) {
			document.body.style.overflow = 'hidden';
			return (): void => {
				document.body.style.overflow = '';
			};
		} else {
			document.body.style.overflow = '';
		}
		return (): void => {
			document.body.style.overflow = '';
		};
	}, [detailId]);

	// Helper function to check if a decision is selected for a scan
	const hasDecision = useCallback((scanId: number): boolean => {
		const decisionValue = decision[scanId.toString()];
		return decisionValue !== undefined && decisionValue !== null && decisionValue.trim() !== '';
	}, [decision]);

// Helper: normalize a value for safe comparison (trim whitespace, lowercase, null → empty)
	const normalizeValue = useCallback((value: string | null | undefined): string => {
		return (value ?? "").trim().toLowerCase();
	}, []);

	// Helper: determine if the expert's selected value differs from the AI prediction
	// Returns true when the expert has changed the result (button should show "Modified")
	// Returns false when unchanged (button should show "Confirm")
	const isResultModified = useCallback((scanId: number): boolean => {
		const decisionValue = decision[scanId.toString()];
		// No selection yet → treat as unchanged (Confirm AI as-is)
		if (!decisionValue || decisionValue.trim() === '') {
			return false;
		}

		const selectedScan = scans.find((scan) => scan.id === scanId);
		if (!selectedScan) return false;

		const aiPrediction = getAiPrediction(selectedScan);
		return normalizeValue(decisionValue) !== normalizeValue(aiPrediction);
	}, [decision, scans, normalizeValue]);

	/**
	 * REAL-TIME VALIDATION: Mark scan as Confirmed or Corrected
	 * 
	 * When a scan is validated:
	 * 1. Scan status is updated in database (triggers Supabase Realtime UPDATE event)
	 * 2. Validation history is created (triggers Supabase Realtime INSERT event)
	 * 3. DataContext receives the real-time events and updates the scans state
	 * 4. This page's filter automatically excludes the scan (no longer 'Pending Validation')
	 * 5. Scan disappears from the list immediately - no refresh needed!
	 * 6. Notification count decreases automatically via NotificationContext
	 * 
	 * All users viewing the Validate page will see the update in real-time.
	 */
	const handleValidation = useCallback(
		async (scanId: number, action: "confirm" | "correct") => {
			if (processingScanId === scanId) return;

			const selectedScan = scans.find((scan) => scan.id === scanId);
			if (!selectedScan) {
				toast.error("Scan not found");
				return;
			}

			if (!user?.id) {
				toast.error("You must be signed in to validate scans.");
				return;
			}

			const scanKey = scanId.toString();
			const noteInput = notes[scanKey];
			const note = noteInput && noteInput.trim() ? noteInput.trim() : null;
			const correctedInput = decision[scanKey];
			const corrected = correctedInput && correctedInput.trim() ? correctedInput.trim() : "";

			if (action === "correct" && !corrected) {
				toast.error("Please select or enter the corrected result.");
				return;
			}

			// Map scan_type for validation_history table
			// validation_history.scan_type uses 'leaf_disease' or 'fruit_maturity'
			const validationScanType = selectedScan.scan_type; // Already 'leaf_disease' or 'fruit_maturity'

			const validationHistoryStatus = action === "confirm" ? "Validated" : "Corrected";
			const scanStatus = "Validated";
			const timestamp = new Date().toISOString();

			// Validate scan_uuid exists and is a valid UUID string
			const scanUuid = selectedScan.scan_uuid; // must be valid UUID string
			if (!scanUuid || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(scanUuid)) {
				toast.error("Invalid scan UUID. Cannot create validation history.");
				console.error("Invalid scan UUID:", {
					scanUuid,
					scanId,
					scan_type: selectedScan.scan_type,
					expectedFormat: "1c8ba06a-50b5-495c-8c91-c094ab04dd49",
				});
				return;
			}

			// Validate expert_id (user.id) is also a valid UUID
			const expertId = user.id.trim();
			if (!expertId || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(expertId)) {
				toast.error("Invalid user session. Please sign in again.");
				console.error("Invalid expert UUID:", { expertId });
				return;
			}

			setProcessingScanId(scanId);

			try {
				// 1️⃣ Fetch AI detected value from the scan table
				// For leaf scans: use disease_detected from leaf_disease_scans
				// For fruit scans: use ripeness_stage from fruit_ripeness_scans
				let aiPrediction: string | null = null;

				if (validationScanType === "leaf_disease") {
					const { data, error } = await supabase
						.from("leaf_disease_scans")
						.select("disease_detected")
						.eq("scan_uuid", scanUuid)
						.single<LeafDiseaseScanResponse>();

					if (error) {
						const errorDetails = extractErrorDetails(error);
						console.error("Error fetching leaf disease scan:", {
							...errorDetails,
							scan_uuid: scanUuid,
							scanId,
							scan_type: validationScanType,
							action,
						});
						toast.error("Failed to fetch scan data.");
						throw error;
					}

					if (!data || !data.disease_detected) {
						const error = new Error("AI prediction (disease_detected) is missing for leaf disease scan.");
						console.error("AI prediction is missing for leaf disease scan:", {
							scanId,
							scanUuid,
							scan_type: validationScanType,
							data,
							action,
						});
						toast.error("AI prediction is missing for leaf disease scan.");
						throw error;
					}

					aiPrediction = data.disease_detected;
				} else if (validationScanType === "fruit_maturity") {
					const { data, error } = await supabase
						.from("fruit_ripeness_scans")
						.select("ripeness_stage")
						.eq("scan_uuid", scanUuid)
						.single<FruitRipenessScanResponse>();

					if (error) {
						const errorDetails = extractErrorDetails(error);
						console.error("Error fetching fruit ripeness scan:", {
							...errorDetails,
							scan_uuid: scanUuid,
							scanId,
							scan_type: validationScanType,
							action,
						});
						toast.error("Failed to fetch scan data.");
						throw error;
					}

					if (!data || !data.ripeness_stage) {
						const error = new Error("AI prediction (ripeness_stage) is missing for fruit maturity scan.");
						console.error("AI prediction is missing for fruit maturity scan:", {
							scanId,
							scanUuid,
							scan_type: validationScanType,
							data,
							action,
						});
						toast.error("AI prediction is missing for fruit maturity scan.");
						throw error;
					}

					aiPrediction = data.ripeness_stage;
				} else {
					const error = new Error("Invalid scan type provided.");
					console.error("Invalid scan type:", {
						scan_type: validationScanType,
						scan_uuid: scanUuid,
						scanId,
						action,
					});
					toast.error("Invalid scan type.");
					throw error;
				}

				// 2️⃣ Determine expert validation based on action
				// When confirming: expert_validation = ai_prediction (expert confirms AI is correct)
				//   - For leaf scans: expert_validation = disease_detected
				//   - For fruit scans: expert_validation = ripeness_stage
				// When correcting: expert_validation = corrected value from dropdown (expert corrects AI)
				let expertValidation: string;
				if (action === "confirm") {
					// Expert confirms: use the same value as AI prediction
					if (!aiPrediction) {
						const error = new Error("AI prediction is missing. Cannot confirm scan.");
						console.error("AI prediction is null when trying to confirm:", {
							scanId,
							scanUuid,
							scan_type: validationScanType,
							action,
						});
						toast.error("AI prediction is missing. Cannot confirm scan.");
						throw error;
					}
					expertValidation = aiPrediction;
				} else {
					// Expert corrects: use the value selected from dropdown
					if (!corrected || corrected.trim() === "") {
						const error = new Error("Corrected value is required when correcting a scan.");
						console.error("Corrected value is missing:", {
							scanId,
							scanUuid,
							scan_type: validationScanType,
							action,
						});
						toast.error("Please select a corrected value.");
						throw error;
					}
					expertValidation = corrected.trim();
				}

				// 3️⃣ Insert into validation_history
				// Required fields: scan_id, scan_type, expert_id, expert_name, ai_prediction, expert_validation, status, validated_at
				// Optional field: expert_comment
				const expertName = profile?.full_name || user.user_metadata?.full_name || "Unknown Expert";

				const { error: historyError } = await supabase
					.from("validation_history")
					.insert({
						scan_id: scanUuid, // UUID from scan table
						scan_type: validationScanType, // 'leaf_disease' or 'fruit_maturity'
						expert_id: expertId, // UUID from user.id
						expert_name: expertName.trim() || "Unknown Expert",
						ai_prediction: aiPrediction, // AI detected value: disease_detected (leaf) or ripeness_stage (fruit)
						expert_validation: expertValidation, // Same as ai_prediction (confirm) or expert's correction (correct)
						expert_comment: (note && note.trim()) || "", // Optional: default to empty string
						status: validationHistoryStatus, // "Validated" (confirm) or "Corrected" (correct)
						validated_at: timestamp, // ISO timestamp
					});

				if (historyError) {
					const errorDetails = extractErrorDetails(historyError);
					console.error("Supabase insert error - validation_history:", {
						...errorDetails,
						scanId,
						scanUuid,
						expertId,
						scan_type: validationScanType,
						action,
					});
					toast.error(`Failed to create validation history: ${errorDetails.message || "Unknown error"}`);
					throw historyError;
				}

				// 4️⃣ Update scan status to "Validated" in the corresponding scan table
				// Both confirm and correct actions set status to "Validated"
				if (validationScanType === "leaf_disease") {
					const { error: updateError } = await supabase
						.from("leaf_disease_scans")
						.update({ status: scanStatus, updated_at: timestamp })
						.eq("scan_uuid", scanUuid);

					if (updateError) {
						const errorDetails = extractErrorDetails(updateError);
						console.error("Supabase update error - leaf_disease_scans:", {
							...errorDetails,
							scan_uuid: scanUuid,
							scanId,
							scan_type: validationScanType,
							action,
							status: scanStatus,
						});
						toast.error("Failed to update scan status.");
						throw updateError;
					}
				} else if (validationScanType === "fruit_maturity") {
					const { error: updateError } = await supabase
						.from("fruit_ripeness_scans")
						.update({ status: scanStatus, updated_at: timestamp })
						.eq("scan_uuid", scanUuid);

					if (updateError) {
						const errorDetails = extractErrorDetails(updateError);
						console.error("Supabase update error - fruit_ripeness_scans:", {
							...errorDetails,
							scan_uuid: scanUuid,
							scanId,
							scan_type: validationScanType,
							action,
							status: scanStatus,
						});
						toast.error("Failed to update scan status.");
						throw updateError;
					}
				}

				// Success
				console.log(`✅ Validation recorded successfully for scan: ${scanUuid}`);
				toast.success(action === "confirm" ? "Scan confirmed." : "Scan corrected.");

				// Update scan status in local state so dashboard cards reflect the change instantly.
				// The validate page filter (status === 'Pending Validation') will hide it automatically.
				updateScanStatusInState(scanId, "Validated");

				setDecision((prev: Record<string, string>) => {
					const { [scanKey]: _, ...rest } = prev;
					return rest;
				});
				setNotes((prev: Record<string, string>) => {
					const { [scanKey]: _, ...rest } = prev;
					return rest;
				});
				if (detailId === scanKey) setDetailId(null);
			} catch (err: unknown) {
				// Log structured error details
				const errorDetails = extractErrorDetails(err);
				console.error("Failed to create validation history:", {
					...errorDetails,
					action,
					scanId,
					scanUuid,
					expertId,
					scan_type: validationScanType,
				});

				toast.error(
					action === "confirm"
						? "Failed to confirm validation."
						: "Failed to correct validation."
				);
			} finally {
				setProcessingScanId((prev: number | null) => (prev === scanId ? null : prev));
			}
		},
		[processingScanId, scans, user, profile, notes, decision, detailId, updateScanStatusInState]
	);

	const onConfirm = useCallback((scanId: number) => handleValidation(scanId, "confirm"), [handleValidation]);
	const onReject = useCallback((scanId: number) => handleValidation(scanId, "correct"), [handleValidation]);

	// Helper function to get date range based on type
	const getDateRangeForFilter = useCallback((type: typeof dateRangeType) => {
		return getDateRange(type, startDate, endDate);
	}, [startDate, endDate]);

	/**
	 * REAL-TIME FILTERING: Automatically filters scans for 'Pending Validation' status
	 * 
	 * This memoized filter ensures:
	 * - Only pending scans are shown (status='Pending Validation')
	 * - New scans appear automatically when inserted via real-time subscriptions
	 * - Validated/corrected scans disappear immediately (filtered out)
	 * - Efficient re-renders only when scans array or filter criteria change
	 * 
	 * The scans array is updated in real-time by DataContext when:
	 * - New scans are inserted with status='Pending Validation'
	 * - Scan status changes (e.g., 'Pending Validation' → 'Validated'/'Corrected')
	 * 
	 * No manual refresh needed - the UI updates automatically!
	 */
	const filtered = useMemo(() => {
		// Early return if no scans
		if (!scans.length) return [];
		
		// Filter for pending validation scans only
		// This automatically excludes scans that have been validated/corrected
		// Also exclude scans with status = 'Unknown' or result = 'Unknown' from display (but they're still counted in Total Scans)
		const pendingScans = scans.filter(scan => {
			// Runtime check for status to handle potential 'Unknown' status
			const status = scan.status as string;
			// Exclude 'Unknown' status scans from display
			if (status === 'Unknown') return false;
			// Only show pending validation scans
			if (status !== 'Pending Validation') return false;
			
			// Check for result = 'Unknown' (disease_detected or ripeness_stage)
			const result = getAiPrediction(scan);
			if (result === 'Unknown') return false;
			
			// Exclude Non-Ampalaya scans — these do not need expert validation
			if (result.toLowerCase().includes('non-ampalaya') || result.toLowerCase().includes('non ampalaya')) return false;
			
			return true;
		});
		
		// Early return if no pending scans
		if (!pendingScans.length) return [];
		
		// Apply additional filters (tab type and date range)
		return pendingScans.filter((scan: Scan) => {
			const matchesTab = tab === 'leaf' ? scan.scan_type === 'leaf_disease' : scan.scan_type === 'fruit_maturity';
			
			// Apply date range filter
			if (dateRangeType !== 'none') {
				const { start, end } = getDateRangeForFilter(dateRangeType);
				if (start && end) {
					const scanDate = new Date(scan.created_at);
					if (scanDate < start || scanDate > end) {
						return false;
					}
				}
			}
			
			return matchesTab;
		});
	}, [scans, dateRangeType, tab, getDateRangeForFilter]);

	// Reset to page 1 when filters change
	useEffect(() => {
		setCurrentPage(1);
	}, [tab, dateRangeType, startDate, endDate]);

	// Calculate total pages
	const totalPages = useMemo(() => {
		return Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	}, [filtered.length]);

	// Ensure currentPage doesn't exceed totalPages when data changes
	useEffect(() => {
		if (currentPage > totalPages) {
			setCurrentPage(totalPages);
		}
	}, [currentPage, totalPages]);

	// Paginated records - show PAGE_SIZE records per page
	const displayedRecords = useMemo(() => {
		const startIndex = (currentPage - 1) * PAGE_SIZE;
		return filtered.slice(startIndex, startIndex + PAGE_SIZE);
	}, [filtered, currentPage]);


	/**
	 * Parse text content into an array of list items for bullet/numbered display.
	 * Handles various formats: numbered lists, comma-separated, line breaks, etc.
	 */
	const parseTextToListItems = useCallback((text: string | null | undefined): string[] => {
		if (!text || typeof text !== 'string') return [];
		
		const trimmed = text.trim();
		if (!trimmed) return [];
		
		// Try to detect numbered list patterns (e.g., "1. item", "1) item", "(1) item")
		const numberedPattern = /^[\s]*(?:\d+[.\)\]\-]|\(\d+\))[\s]+/m;
		if (numberedPattern.test(trimmed)) {
			// Split by numbered patterns and filter empty items
			const items = trimmed
				.split(/(?:^|\n)[\s]*(?:\d+[.\)\]\-]|\(\d+\))[\s]+/)
				.map(item => item.trim())
				.filter(item => item.length > 0);
			if (items.length > 0) return items;
		}
		
		// Try to detect bullet points (e.g., "• item", "- item", "* item")
		const bulletPattern = /^[\s]*[•\-\*][\s]+/m;
		if (bulletPattern.test(trimmed)) {
			const items = trimmed
				.split(/(?:^|\n)[\s]*[•\-\*][\s]+/)
				.map(item => item.trim())
				.filter(item => item.length > 0);
			if (items.length > 0) return items;
		}
		
		// Try line breaks (if multiple lines exist)
		if (trimmed.includes('\n')) {
			const items = trimmed
				.split(/\n+/)
				.map(item => item.replace(/^[\s]*[•\-\*\d+.\)]+[\s]*/g, '').trim())
				.filter(item => item.length > 0);
			if (items.length > 1) return items;
		}
		
		// Try semicolon-separated items
		if (trimmed.includes(';')) {
			const items = trimmed
				.split(/;/)
				.map(item => item.trim())
				.filter(item => item.length > 0);
			if (items.length > 1) return items;
		}
		
		// Try comma-separated items (only if items look like distinct phrases)
		if (trimmed.includes(',')) {
			const items = trimmed
				.split(/,/)
				.map(item => item.trim())
				.filter(item => item.length > 0);
			// Only use comma split if we have multiple items and they're not too short
			if (items.length > 1 && items.every(item => item.length >= 3)) return items;
		}
		
		// Return as single item if no pattern detected
		return [trimmed];
	}, []);

	// Parse scan result details from scan data
	// Updated to use new schema: leaf_disease_scans and fruit_ripeness_scans
	const parseScanDetails = useCallback((scan: Scan) => {
		// Use helper functions to get data from new schema
		const disease = getAiPrediction(scan); // Gets disease_detected or ripeness_stage
		const confidence = scan.confidence;
		const solution = getSolution(scan); // Gets solution or harvest_recommendation
		const recommendedProducts = getRecommendedProducts(scan); // Gets recommendation (only for leaf scans)

		// Format confidence as percentage with 2 decimal places
		// Formula: confidence (%) = confidence * 100
		// Example: 0.835 → 83.50%
		let confidencePercentage: number | null = null;
		let formattedConfidence: string = 'N/A';
		
		if (confidence !== null && confidence !== undefined) {
			let confidenceValue: number;
			
			if (typeof confidence === 'number') {
				confidenceValue = confidence;
			} else {
				// Try to parse string to number
				const parsedConfidence = parseFloat(String(confidence));
				if (!isNaN(parsedConfidence)) {
					confidenceValue = parsedConfidence;
				} else {
					return {
						disease: disease || 'N/A',
						confidence: 'N/A',
						confidencePercentage: null,
						solution: solution || null,
						recommendedProducts: recommendedProducts || null,
					};
				}
			}
			
			// Convert decimal (0-1) to percentage (0-100) and format with 2 decimal places
			confidencePercentage = confidenceValue * 100;
			formattedConfidence = `${confidencePercentage.toFixed(2)}%`;
		}

		return {
			disease: disease || 'N/A',
			confidence: formattedConfidence,
			confidencePercentage,
			solution: solution || null,
			recommendedProducts: recommendedProducts || null,
		};
	}, []);

	return (
		<AuthGuard>
			<AppShell>
				<div className="space-y-6">
					{/* Header with Toggle Buttons */}
					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
						<div>
							<h2 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Validation</h2>
							<p className="text-sm text-gray-500 mt-0.5">Review and validate farmer scan submissions</p>
						</div>
						<div className="inline-flex rounded-xl border border-gray-200 overflow-hidden bg-white shadow-sm self-start sm:self-auto">
							<button
								className={`px-5 py-2.5 text-sm font-medium transition-all flex items-center gap-2 ${
									tab === 'leaf'
										? 'bg-[#388E3C] text-white shadow-sm'
										: 'text-gray-700 hover:bg-gray-50'
								}`}
								onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
									e.preventDefault();
									setTab('leaf');
								}}
							>
								<Image src="/images/leaf-icon.png" alt="Leaf Disease" width={20} height={20} className="h-5 w-5 object-contain" />
								Leaf Disease
							</button>
							<button
								className={`px-5 py-2.5 text-sm font-medium transition-all flex items-center gap-2 ${
									tab === 'fruit'
										? 'bg-[#388E3C] text-white shadow-sm'
										: 'text-gray-700 hover:bg-gray-50'
								}`}
								onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
									e.preventDefault();
									setTab('fruit');
								}}
							>
								<Image src="/images/fruit-icon.png" alt="Fruit Ripeness" width={20} height={20} className="h-5 w-5 object-contain" />
								Fruit Ripeness
							</button>
						</div>
					</div>

					{/* Date Range Filter */}
					<div className="flex flex-wrap items-center gap-3 bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
						<div className="flex items-center gap-2 text-sm font-medium text-gray-700">
							<Calendar className="h-4 w-4 text-gray-400" />
							<span>Filter by Date</span>
						</div>
						<div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
							<button
								className={`px-3.5 py-1.5 text-xs font-medium transition-all ${
									dateRangeType === 'daily'
										? 'bg-[#388E3C] text-white'
										: 'text-gray-600 hover:bg-white'
								}`}
								onClick={() => {
									setDateRangeType('daily');
									setStartDate("");
									setEndDate("");
								}}
							>
								Daily
							</button>
							<button
								className={`px-3.5 py-1.5 text-xs font-medium transition-all ${
									dateRangeType === 'weekly'
										? 'bg-[#388E3C] text-white'
										: 'text-gray-600 hover:bg-white'
								}`}
								onClick={() => {
									setDateRangeType('weekly');
									setStartDate("");
									setEndDate("");
								}}
							>
								Weekly
							</button>
							<button
								className={`px-3.5 py-1.5 text-xs font-medium transition-all ${
									dateRangeType === 'monthly'
										? 'bg-[#388E3C] text-white'
										: 'text-gray-600 hover:bg-white'
								}`}
								onClick={() => {
									setDateRangeType('monthly');
									setStartDate("");
									setEndDate("");
								}}
							>
								Monthly
							</button>
							<button
								className={`px-3.5 py-1.5 text-xs font-medium transition-all ${
									dateRangeType === 'custom'
										? 'bg-[#388E3C] text-white'
										: 'text-gray-600 hover:bg-white'
								}`}
								onClick={() => {
									setDateRangeType('custom');
									if (!startDate || !endDate) {
										const today = new Date().toISOString().split('T')[0];
										const weekAgo = new Date();
										weekAgo.setDate(weekAgo.getDate() - 7);
										setStartDate(weekAgo.toISOString().split('T')[0]);
										setEndDate(today);
									}
								}}
							>
								Custom
							</button>
						</div>
						{dateRangeType === 'custom' && (
							<div className="flex items-center gap-2">
								<input
									type="date"
									value={startDate}
									onChange={(e) => setStartDate(e.target.value)}
									max={endDate || undefined}
									className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent"
								/>
								<span className="text-sm text-gray-500">to</span>
								<input
									type="date"
									value={endDate}
									onChange={(e) => setEndDate(e.target.value)}
									min={startDate || undefined}
									max={new Date().toISOString().split('T')[0]}
									className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent"
								/>
							</div>
						)}
						{dateRangeType !== 'none' && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									setDateRangeType('none');
									setStartDate("");
									setEndDate("");
								}}
								className="text-gray-500 hover:text-gray-900 h-8"
							>
								<X className="h-3.5 w-3.5 mr-1" />
								Clear
							</Button>
						)}
					</div>

					{/* Cards */}
					{error ? (
						<Card className="border border-red-100 shadow-sm">
							<CardContent className="flex flex-col items-center justify-center py-12">
								<AlertCircle className="h-10 w-10 text-red-400 mb-3" />
								<p className="text-red-600 font-medium">{error}</p>
								<Button
									variant="outline"
									size="sm"
									onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
										e.preventDefault();
										refreshData(true);
									}}
									className="mt-3"
								>
									Try Again
								</Button>
							</CardContent>
						</Card>
					) : (loading && !forceRender) ? (
						<Card className="border border-gray-100 shadow-sm">
							<CardContent className="flex flex-col items-center justify-center py-12">
								<Loader2 className="h-8 w-8 animate-spin text-[#388E3C] mb-3" />
								<p className="text-gray-600 text-sm">Loading pending scans...</p>
							</CardContent>
						</Card>
					) : filtered.length === 0 ? (
						<Card className="border border-gray-100 shadow-sm">
							<CardContent className="flex flex-col items-center justify-center py-12 text-center">
								<ClipboardCheck className="h-10 w-10 text-gray-300 mb-3" />
								<p className="text-gray-500 font-medium text-sm">No pending scans found</p>
								<p className="text-gray-400 text-xs mt-1">New scans will appear here when farmers submit them.</p>
							</CardContent>
						</Card>
					) : (
						<Card className="border border-gray-100 shadow-sm overflow-hidden">
							<div className="overflow-x-auto">
								<Table>
									<Thead>
										<Tr className="bg-gray-50/80 border-b border-gray-100">
											<Th className="w-20 text-xs font-semibold text-gray-500 uppercase tracking-wider py-3">Image</Th>
											<Th className="text-xs font-semibold text-gray-500 uppercase tracking-wider py-3">Farmer</Th>
											<Th className="text-xs font-semibold text-gray-500 uppercase tracking-wider py-3">Type</Th>
											<Th className="text-xs font-semibold text-gray-500 uppercase tracking-wider py-3">Status</Th>
											<Th className="text-xs font-semibold text-gray-500 uppercase tracking-wider py-3">Date</Th>
											<Th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider py-3">Action</Th>
										</Tr>
									</Thead>
									<Tbody>
										{displayedRecords.map((scan: Scan) => {
											const cropType = scan.scan_type === 'leaf_disease' ? 'Leaf Disease' : 'Fruit Ripeness';
											const farmerName = scan.farmer_profile?.full_name || scan.farmer_profile?.username || 'Unknown Farmer';
											const uniqueKey = scan.scan_uuid || `${scan.scan_type}-${scan.id}`;

											const getStatusBadge = (status: string) => {
												switch (status) {
													case 'Pending Validation':
														return 'bg-amber-50 text-amber-700 border-amber-200';
													case 'Validated':
														return 'bg-emerald-50 text-emerald-700 border-emerald-200';
													case 'Corrected':
														return 'bg-blue-50 text-blue-700 border-blue-200';
													default:
														return 'bg-gray-50 text-gray-600 border-gray-200';
												}
											};

											return (
												<Tr
													key={uniqueKey}
													onClick={(): void => setDetailId(scan.id.toString())}
													className="cursor-pointer hover:bg-gray-50/60 transition-colors duration-150 border-b border-gray-50 last:border-b-0"
												>
												<Td className="py-3">
													<div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex-shrink-0">
														{(() => {
															const imageUrl = getScanImageUrlWithFallback(scan);
															const imageKey = scan.scan_uuid || `scan-thumb-${scan.id}`;
															const thumbErrorKey = `thumb-error-${scan.id}-${scan.scan_uuid || 'unknown'}`;

															if (!imageUrl) {
																return (
																	<div className="w-full h-full flex items-center justify-center bg-gray-100">
																		<AlertCircle className="w-5 h-5 text-gray-300" />
																	</div>
																);
															}

															return (
																<Image
																	key={imageKey}
																	src={imageUrl}
																	alt={`Scan preview`}
																	width={48}
																	height={48}
																	className="w-full h-full object-cover"
																	loading="lazy"
																	priority={false}
																	unoptimized={true}
																	onError={(e: React.SyntheticEvent<HTMLImageElement, Event>): void => {
																		throttledErrorLog(thumbErrorKey, `[Validate Page] Thumbnail not available:`, {
																			scan_id: scan.id,
																			scan_uuid: scan.scan_uuid || 'N/A'
																		});
																		e.currentTarget.style.display = 'none';
																	}}
																/>
															);
														})()}
													</div>
												</Td>
												<Td className="py-3">
													<div className="flex items-center gap-2.5">
														{scan.farmer_profile?.profile_picture ? (
															<Image
																src={scan.farmer_profile.profile_picture}
																alt="Profile"
																width={28}
																height={28}
																className="w-7 h-7 rounded-full object-cover flex-shrink-0 border border-gray-100"
																onError={(e: React.SyntheticEvent<HTMLImageElement, Event>): void => {
																	e.currentTarget.style.display = 'none';
																}}
															/>
														) : (
															<div className="w-7 h-7 rounded-full bg-emerald-50 flex items-center justify-center text-xs font-semibold text-[#388E3C] flex-shrink-0 border border-emerald-100">
																{farmerName.charAt(0).toUpperCase()}
															</div>
														)}
														<span className="font-medium text-sm text-gray-900 truncate max-w-[120px] sm:max-w-[160px]">{farmerName}</span>
													</div>
												</Td>
												<Td className="py-3">
													<span className="text-xs text-gray-600">{cropType}</span>
												</Td>
												<Td className="py-3">
													<span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusBadge(scan.status)}`}>
														{scan.status}
													</span>
												</Td>
												<Td className="py-3">
													<span className="text-xs text-gray-500">{formatDate(scan.created_at)}</span>
												</Td>
												<Td className="text-right py-3" onClick={(e: React.MouseEvent<HTMLTableCellElement>): void => e.stopPropagation()}>
													<Button
														variant="outline"
														size="sm"
														onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
															e.preventDefault();
															e.stopPropagation();
															setDetailId(scan.id.toString());
														}}
														className="h-8 text-xs font-medium text-[#388E3C] bg-white border-[#388E3C]/20 hover:bg-[#388E3C]/5 hover:border-[#388E3C]/40 hover:text-[#388E3C] transition-all duration-200"
													>
														<Eye className="h-3.5 w-3.5 mr-1.5" />
														View
													</Button>
												</Td>
											</Tr>
										);
									})}
									</Tbody>
								</Table>
							</div>
							{/* Pagination Controls */}
							<div className="border-t border-gray-100 px-4 py-3 bg-gray-50/50">
								<Pagination
									currentPage={currentPage}
									totalRecords={filtered.length}
									pageSize={PAGE_SIZE}
									onPageChange={setCurrentPage}
									showInfo={true}
								/>
							</div>
						</Card>
					)}

					<Dialog open={!!detailId} onOpenChange={(open: boolean): void => {
						if (!open) {
							// Reset image URL attempts when dialog closes
							if (detailId) {
								const scan = scans.find((s: Scan) => s.id.toString() === detailId);
								if (scan) {
									const attemptKey = scan.scan_uuid || scan.id.toString();
									setImageUrlAttempts((prev: Record<string, number>): Record<string, number> => {
										const next: Record<string, number> = { ...prev };
										delete next[attemptKey];
										return next;
									});
								}
							}
							setDetailId(null);
						}
					}} maxWidthClass="max-w-5xl">
						<DialogContent className="p-0 flex flex-col max-h-[92vh] overflow-hidden">
							{detailId && (() => {
								const selectedScan = scans.find((scan: Scan) => scan.id.toString() === detailId);
								if (!selectedScan) {
									return (
										<div className="p-8 text-center">
											<AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
											<p className="text-base font-medium text-gray-900 mb-2">Scan not found</p>
											<p className="text-sm text-gray-500">The scan you&apos;re looking for may have been removed or doesn&apos;t exist.</p>
											<Button
												variant="outline"
												onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
													e.preventDefault();
													setDetailId(null);
												}}
												className="mt-4"
											>
												Close
											</Button>
										</div>
									);
								}

								const scanDetails = parseScanDetails(selectedScan);
								const cropType = selectedScan.scan_type === 'leaf_disease' ? 'Leaf Disease' : 'Fruit Ripeness';
								const farmerName = selectedScan.farmer_profile?.full_name || selectedScan.farmer_profile?.username || 'Unknown Farmer';
								const scanIdShort = selectedScan.scan_uuid ? `#${selectedScan.scan_uuid.split('-')[0].toUpperCase()}` : `#${selectedScan.id}`;
								const expertValue = decision[detailId!] ?? '';
								const aiPrediction = getAiPrediction(selectedScan) || 'N/A';
								const isMatch = expertValue && normalizeValue(expertValue) === normalizeValue(aiPrediction);
								const confidenceColor = scanDetails.confidencePercentage !== null
									? scanDetails.confidencePercentage >= 80 ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
									: scanDetails.confidencePercentage >= 60 ? 'bg-amber-50 text-amber-700 border-amber-200'
									: 'bg-red-50 text-red-700 border-red-200'
									: 'bg-gray-50 text-gray-600 border-gray-200';

								return (
									<>
										{/* Modal Header */}
										<div className="flex items-center justify-between px-5 sm:px-6 py-4 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] flex-shrink-0 relative overflow-hidden">
											<div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl pointer-events-none" />
											<div className="absolute -bottom-10 -left-10 w-32 h-32 rounded-full bg-white/5 blur-2xl pointer-events-none" />
											<DialogHeader className="p-0 relative">
												<div className="flex items-start gap-3">
													<div className="h-10 w-10 rounded-xl bg-white/15 backdrop-blur-sm flex items-center justify-center ring-1 ring-white/25 flex-shrink-0">
														<ClipboardCheck className="h-5 w-5 !text-white" />
													</div>
													<div>
														<DialogTitle className="text-lg sm:text-xl font-bold !text-white tracking-tight">Scan Validation Details</DialogTitle>
														<p className="text-xs sm:text-sm !text-white/85 mt-0.5">Review the AI prediction and provide your expert validation</p>
													</div>
												</div>
											</DialogHeader>
											<button
												aria-label="Close"
												onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
													e.preventDefault();
													setDetailId(null);
												}}
												className="relative flex-shrink-0 rounded-lg p-2 bg-white/20 hover:bg-white/30 !text-white ring-1 ring-white/20 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/50"
											>
												<X className="h-4 w-4 !text-white" />
											</button>
										</div>

										{/* Scrollable Body */}
										<div className="flex-1 overflow-y-auto bg-slate-50">
											{/* Metadata Summary Strip — modern info tiles */}
											<div className="px-5 sm:px-6 py-3.5 bg-white border-b border-gray-100">
												<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
													<div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
														<User className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
														<div className="min-w-0">
															<p className="text-[10px] text-gray-400 uppercase tracking-wider leading-none">Farmer</p>
															<p className="text-xs font-semibold text-gray-800 truncate">{farmerName}</p>
														</div>
													</div>
													<div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
														<Calendar className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
														<div className="min-w-0">
															<p className="text-[10px] text-gray-400 uppercase tracking-wider leading-none">Date Scanned</p>
															<p className="text-xs font-semibold text-gray-800 truncate">{formatDate(selectedScan.created_at)}</p>
														</div>
													</div>
													<div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
														<ScanLine className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
														<div className="min-w-0">
															<p className="text-[10px] text-gray-400 uppercase tracking-wider leading-none">Scan Type</p>
															<p className="text-xs font-semibold text-gray-800 truncate">{cropType}</p>
														</div>
													</div>
													<div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
														<Activity className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
														<div className="min-w-0">
															<p className="text-[10px] text-gray-400 uppercase tracking-wider leading-none">Status</p>
															<span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${selectedScan.status === 'Pending Validation' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
																{selectedScan.status}
															</span>
														</div>
													</div>
													<div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-50 border border-gray-100">
														<ClipboardCheck className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
														<div className="min-w-0">
															<p className="text-[10px] text-gray-400 uppercase tracking-wider leading-none">Scan ID</p>
															<p className="text-xs font-mono font-semibold text-gray-700 truncate">{scanIdShort}</p>
														</div>
													</div>
												</div>
											</div>

											{/* Main Content — Row 1: Image (left) + AI Prediction & Expert Validation (right) */}
											<div className="px-5 sm:px-6 py-5 space-y-5">
												<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
													{/* Left Column - Scan Image */}
													<div>
														<Card className="border border-gray-100 shadow-sm h-full">
															<div className="p-4">
																<div className="flex items-center justify-between mb-3">
																	<span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Scan Image</span>
																	<div className="flex items-center gap-1">
																		<button
																			onClick={() => {
																				const allUrls = getAllPossibleImageUrls(selectedScan);
																				if (allUrls.length > 0) window.open(allUrls[0], '_blank');
																			}}
																			className="p-1.5 rounded-md text-gray-400 hover:text-[#388E3C] hover:bg-emerald-50 transition-colors"
																			title="Zoom"
																		>
																			<ZoomIn className="h-3.5 w-3.5" />
																		</button>
																		<button
																			onClick={() => {
																				const allUrls = getAllPossibleImageUrls(selectedScan);
																				if (allUrls.length > 0) window.open(allUrls[0], '_blank');
																			}}
																			className="p-1.5 rounded-md text-gray-400 hover:text-[#388E3C] hover:bg-emerald-50 transition-colors"
																			title="Expand"
																		>
																			<Maximize2 className="h-3.5 w-3.5" />
																		</button>
																		<button
																			onClick={() => {
																				const allUrls = getAllPossibleImageUrls(selectedScan);
																				if (allUrls.length > 0) {
																					const a = document.createElement('a');
																					a.href = allUrls[0];
																					a.download = `scan-${selectedScan.scan_uuid || selectedScan.id}.jpg`;
																					a.target = '_blank';
																					a.click();
																				}
																			}}
																			className="p-1.5 rounded-md text-gray-400 hover:text-[#388E3C] hover:bg-emerald-50 transition-colors"
																			title="Download"
																		>
																			<Download className="h-3.5 w-3.5" />
																		</button>
																	</div>
																</div>
																<div className="w-full bg-gray-100 rounded-xl overflow-hidden border border-gray-200" style={{ minHeight: '280px' }}>
																	{(() => {
																		const allUrls = getAllPossibleImageUrls(selectedScan);
																		const attemptKey = selectedScan?.scan_uuid || selectedScan?.id?.toString() || 'unknown';
																		const attemptIndex = imageUrlAttempts[attemptKey] || 0;
																		const imageUrl = allUrls.length > 0 && attemptIndex < allUrls.length ? allUrls[attemptIndex] : null;
																		const scanUuid = selectedScan?.scan_uuid ? String(selectedScan.scan_uuid) : 'N/A';
																		const scanType = selectedScan?.scan_type ? String(selectedScan.scan_type) : 'N/A';
																		const scanId = selectedScan?.id ? String(selectedScan.id) : 'N/A';
																		const errorKey = `image-error-${scanId}-${scanUuid}`;

																		if (!imageUrl || allUrls.length === 0) {
																			return (
																				<div className="flex flex-col items-center justify-center h-full min-h-[280px]">
																					<AlertCircle className="h-8 w-8 text-gray-300 mb-2" />
																					<p className="text-sm text-gray-400">Image not available</p>
																				</div>
																			);
																		}

																		const imageKey = `${scanUuid !== 'N/A' ? scanUuid : `scan-${scanId}`}-attempt-${attemptIndex}`;

																		return (
																			<Image
																				key={imageKey}
																				src={imageUrl}
																				alt="Scan preview"
																				width={700}
																				height={400}
																				className="w-full h-full object-contain"
																				style={{ minHeight: '280px' }}
																				unoptimized={true}
																				onError={(e: React.SyntheticEvent<HTMLImageElement, Event>): void => {
																					if (attemptIndex < allUrls.length - 1) {
																						setImageUrlAttempts((prev: Record<string, number>): Record<string, number> => ({
																							...prev,
																							[attemptKey]: attemptIndex + 1
																						}));
																						return;
																					}
																					throttledErrorLog(errorKey, '[Validate Page] Image not available:', {
																						scan_uuid: scanUuid,
																						scan_type: scanType,
																						scan_id: scanId
																					});
																					e.currentTarget.style.display = 'none';
																				}}
																				onLoad={(): void => {
																					errorThrottle.delete(errorKey);
																					setImageUrlAttempts((prev: Record<string, number>): Record<string, number> => {
																						const next: Record<string, number> = { ...prev };
																						delete next[attemptKey];
																						return next;
																					});
																				}}
																			/>
																		);
																	})()}
																</div>
															</div>
														</Card>
													</div>

													{/* Right Column — AI Prediction + Expert Validation stacked */}
													<div className="space-y-4">
														{/* AI Prediction Card */}
														<Card className="border border-gray-100 shadow-sm">
															<div className="p-4">
																<div className="flex items-center gap-2 mb-3">
																	<Activity className="h-4 w-4 text-[#388E3C]" />
																	<span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">AI Prediction</span>
																</div>
																<div className="space-y-3">
																	<div>
																		<p className="text-xs text-gray-500 mb-0.5">{selectedScan.scan_type === 'leaf_disease' ? 'Detected Disease' : 'Ripeness Stage'}</p>
																		<p className="text-lg font-bold text-gray-900">{scanDetails.disease}</p>
																	</div>
																	<div className="flex items-center gap-2">
																		<span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${confidenceColor}`}>
																			Confidence: {scanDetails.confidence}
																		</span>
																	</div>
																	{scanDetails.confidencePercentage !== null && (
																		<div className="h-2 bg-gray-100 rounded-full overflow-hidden">
																			<div
																				className={`h-full rounded-full transition-all duration-500 ${
																					scanDetails.confidencePercentage >= 80 ? 'bg-emerald-500' :
																					scanDetails.confidencePercentage >= 60 ? 'bg-amber-500' :
																					'bg-red-500'
																				}`}
																				style={{ width: `${Math.min(scanDetails.confidencePercentage, 100)}%` }}
																			/>
																		</div>
																	)}
																</div>
															</div>
														</Card>

														{/* Expert Validation Form */}
														<Card className="border border-gray-100 shadow-sm">
															<div className="p-4">
																<div className="flex items-center gap-2 mb-3">
																	<ShieldCheck className="h-4 w-4 text-[#388E3C]" />
																	<span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Expert Validation</span>
																</div>
																<div className="space-y-4">
																	<div>
																		<label className="block text-xs font-medium text-gray-700 mb-1.5">
																			{selectedScan.scan_type === 'leaf_disease' ? 'Diagnosis' : 'Ripeness Stage'}
																			<span className="text-red-500 ml-0.5">*</span>
																		</label>
																		{selectedScan.scan_type === 'leaf_disease' ? (
																			<select
																				value={decision[detailId!] ?? ''}
																				onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => setDecision({...decision, [detailId!]: e.target.value})}
																				className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-[#388E3C] bg-white transition-all"
																			>
																				<option value="">Select diagnosis</option>
																				<option>Healthy</option>
																				<option>Fusarium Wilt</option>
																				<option>Downy Mildew</option>
																				<option>Yellow Mosaic Virus</option>
																				<option>Cercospora</option>
																				<option>Other</option>
																			</select>
																		) : (
																			<select
																				value={decision[detailId!] ?? ''}
																				onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => setDecision({...decision, [detailId!]: e.target.value})}
																				className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-[#388E3C] bg-white transition-all"
																			>
																				<option value="">Select ripeness stage</option>
																				<option>Immature</option>
																				<option>Mature</option>
																				<option>Overmature</option>
																				<option>Overripe</option>
																			</select>
																		)}
																	</div>

																	<div>
																		<label className="block text-xs font-medium text-gray-700 mb-1.5">Expert Notes <span className="text-gray-400 font-normal">(Optional)</span></label>
																		<div className="relative">
																			<textarea
																				value={notes[detailId!] ?? ''}
																				onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void => {
																					if (e.target.value.length <= 500) {
																						setNotes({...notes, [detailId!]: e.target.value});
																					}
																				}}
																				placeholder="Add notes or recommendations..."
																				className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-[#388E3C] resize-none transition-all"
																				rows={3}
																				maxLength={500}
																			/>
																			<span className="absolute bottom-2 right-3 text-[10px] text-gray-400">{(notes[detailId!] ?? '').length} / 500</span>
																		</div>
																	</div>
																</div>
															</div>
														</Card>
													</div>
												</div>

												{/* Row 2: AI vs Expert Summary (left) + Recommended Solution (right) */}
												<div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
													{/* AI vs Expert Summary */}
													<Card className={`border shadow-sm ${expertValue ? (isMatch ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40') : 'border-gray-100 bg-white'}`}>
														<div className="p-4">
															<div className="flex items-center gap-2 mb-3">
																<ClipboardCheck className="h-4 w-4 text-[#388E3C]" />
																<span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">AI vs Expert Summary</span>
															</div>
															{expertValue ? (
																<>
																	<div className="grid grid-cols-3 gap-3">
																		<div>
																			<p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">AI Prediction</p>
																			<p className="text-sm font-semibold text-[#388E3C]">{aiPrediction}</p>
																		</div>
																		<div>
																			<p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Expert Validation</p>
																			<p className="text-sm font-semibold text-[#388E3C]">{expertValue}</p>
																		</div>
																		<div>
																			<p className="text-[10px] text-gray-500 uppercase tracking-wide mb-0.5">Result</p>
																			<span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${
																				isMatch
																					? 'bg-emerald-50 text-emerald-700 border-emerald-200'
																					: 'bg-amber-50 text-amber-700 border-amber-200'
																			}`}>
																				{isMatch ? (
																					<><CheckCircle2 className="h-3 w-3" /> Match — AI Confirmed</>
																				) : (
																					<><AlertCircle className="h-3 w-3" /> Modified by Expert</>
																				)}
																			</span>
																		</div>
																	</div>
																	<p className="text-xs text-gray-500 mt-3">
																		{isMatch
																			? 'The expert validation matches the AI prediction.'
																			: 'The expert has corrected the AI prediction.'}
																	</p>
																</>
															) : (
																<p className="text-xs text-gray-400 italic">Select a diagnosis above to see the comparison.</p>
															)}
														</div>
													</Card>

													{/* Recommended Solution */}
													<Card className="border border-gray-100 shadow-sm">
														<div className="p-4">
															<div className="flex items-center gap-2 mb-3">
																<Lightbulb className="h-4 w-4 text-[#388E3C]" />
																<span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recommended Solution</span>
															</div>
															{scanDetails.solution ? (
																(() => {
																	const items = parseTextToListItems(scanDetails.solution);
																	return items.length > 1 ? (
																		<ul className="space-y-2">
																			{items.map((item, index) => (
																				<li key={index} className="flex items-start gap-2 text-sm text-gray-700">
																					<CheckCircle2 className="h-4 w-4 text-[#388E3C] mt-0.5 flex-shrink-0" />
																					<span className="leading-relaxed">{item}</span>
																				</li>
																			))}
																		</ul>
																	) : (
																		<p className="text-sm text-gray-700 leading-relaxed">{items[0] || scanDetails.solution}</p>
																	);
																})()
															) : (
																<p className="text-xs text-gray-400 italic">No recommendation available for this scan.</p>
															)}
														</div>
													</Card>
												</div>
											</div>
										</div>

										{/* Modal Footer */}
										<div className="bg-white border-t border-gray-100 px-5 sm:px-6 py-3.5 flex-shrink-0">
											<DialogFooter className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3">
												<Button
													variant="outline"
													size="sm"
													onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
														e.preventDefault();
														setDetailId(null);
													}}
													className="h-9 text-sm font-medium text-gray-600 border-gray-200 hover:bg-gray-50 hover:text-gray-900 transition-all"
												>
													Cancel
												</Button>
												{(() => {
													const scanIdNum = parseInt(detailId);
													const modified = isResultModified(scanIdNum);
													const isProcessing = processingScanId === scanIdNum;

													if (modified) {
														return (
															<Button
																size="sm"
																onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
																	e.preventDefault();
																	onReject(scanIdNum);
																}}
																disabled={!hasDecision(scanIdNum) || isProcessing}
																className="h-9 text-sm font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all"
															>
																{isProcessing ? 'Processing...' : 'Confirm Correction'}
															</Button>
														);
													}

													return (
														<Button
															size="sm"
															onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
																e.preventDefault();
																onConfirm(scanIdNum);
															}}
															disabled={isProcessing}
															className="h-9 text-sm font-semibold bg-[#388E3C] text-white hover:bg-[#2F7A33] disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all"
														>
															{isProcessing ? (
																<Loader2 className="h-4 w-4 animate-spin" />
															) : (
																<>
																	<CheckCircle2 className="h-4 w-4 mr-1.5" />
																	Confirm Validation
																</>
															)}
														</Button>
													);
												})()}
											</DialogFooter>
										</div>
									</>
								);
								})()}
							</DialogContent>
					</Dialog>
				</div>
			</AppShell>
		</AuthGuard>
	);
}
