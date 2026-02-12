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
import { Loader2, AlertCircle, X, Eye } from "lucide-react";
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

	// Prevent body scroll when modal is open and fix dialog sizing
	useEffect(() => {
		if (detailId) {
			document.body.style.overflow = 'hidden';
			// Fix dialog wrapper sizing for larger modals
			const timer: NodeJS.Timeout = setTimeout((): void => {
				const dialogWrapper = document.querySelector('[data-open="true"]');
				if (dialogWrapper) {
					(dialogWrapper as HTMLElement).style.maxWidth = '72rem'; // 6xl = 72rem
					(dialogWrapper as HTMLElement).style.width = 'calc(100% - 2rem)';
				}
				// Reset scroll position to top when opening dialog
				const scrollContainer = document.querySelector('.scrollable-details-content');
				if (scrollContainer) {
					scrollContainer.scrollTop = 0;
				}
			}, 10);
			return (): void => {
				clearTimeout(timer);
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

	// Helper function to check if Confirm button should be disabled
	// Confirm is enabled when:
	// - No decision is selected (user can confirm with default AI prediction)
	// - Decision matches the AI prediction (user confirms the default value)
	// Confirm is disabled when:
	// - Decision is different from AI prediction (user wants to correct, not confirm)
	const isConfirmDisabled = useCallback((scanId: number): boolean => {
		const decisionValue = decision[scanId.toString()];
		// If no decision selected, allow confirmation (will use AI prediction as default)
		if (!decisionValue || decisionValue.trim() === '') {
			return false;
		}
		
		// Find the scan to get AI prediction
		const selectedScan = scans.find((scan) => scan.id === scanId);
		if (!selectedScan) {
			return true; // Disable if scan not found
		}
		
		// Get AI prediction (default value)
		const aiPrediction = getAiPrediction(selectedScan);
		
		// If decision matches AI prediction, allow confirmation
		// If decision is different, disable confirmation (user should use Correct instead)
		return decisionValue.trim() !== aiPrediction?.trim();
	}, [decision, scans]);

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


	// Parse scan result details from scan data
	// Updated to use new schema: leaf_disease_scans and fruit_ripeness_scans
	const parseScanDetails = useCallback((scan: Scan) => {
		// Use helper functions to get data from new schema
		const disease = getAiPrediction(scan); // Gets disease_detected or ripeness_stage
		const confidence = scan.confidence;
		const solution = getSolution(scan); // Gets solution or harvest_recommendation
		const recommendedProducts = getRecommendedProducts(scan); // Gets recommendation (only for leaf scans)

		// Format confidence as "Confidence: X.XX%" (convert decimal to percentage with 2 decimal places)
		// Formula: confidence (%) = confidence * 100
		// Example: 0.835 → 83.50%
		let formattedConfidence = null;
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
					formattedConfidence = 'Confidence: N/A';
					return {
						disease: disease || 'N/A',
						confidence: formattedConfidence,
						solution: solution || null,
						recommendedProducts: recommendedProducts || null,
					};
				}
			}
			
			// Convert decimal (0-1) to percentage (0-100) and format with 2 decimal places
			const confidencePercentage = confidenceValue * 100;
			formattedConfidence = `Confidence: ${confidencePercentage.toFixed(2)}%`;
		} else {
			formattedConfidence = 'Confidence: N/A';
		}

		return {
			disease: disease || 'N/A',
			confidence: formattedConfidence,
			solution: solution || null,
			recommendedProducts: recommendedProducts || null,
		};
	}, []);

	return (
		<AuthGuard>
			<AppShell>
				<div className="space-y-6">
					{/* Header with Toggle Buttons */}
					<div className="flex items-center justify-between">
						<h2 className="text-2xl font-semibold text-gray-900">Validation</h2>
						<div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
							<button 
								className={`px-5 py-2.5 text-sm font-medium transition-all ${
									tab === 'leaf' 
										? 'bg-[var(--primary)] text-white shadow-sm' 
										: 'text-gray-700 hover:bg-gray-50'
								}`} 
								onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
									e.preventDefault();
									setTab('leaf');
								}}
							>
								Leaf Disease
							</button>
							<button 
								className={`px-5 py-2.5 text-sm font-medium transition-all ${
									tab === 'fruit' 
										? 'bg-[var(--primary)] text-white shadow-sm' 
										: 'text-gray-700 hover:bg-gray-50'
								}`} 
								onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
									e.preventDefault();
									setTab('fruit');
								}}
							>
								Fruit Ripeness
							</button>
						</div>
					</div>

					{/* Date Range Filter */}
					<div className="flex flex-wrap items-center gap-3">
						<label className="text-sm font-medium text-gray-700 whitespace-nowrap">
							Filter by Date:
						</label>
						<div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-white shadow-sm">
							<button 
								className={`px-4 py-2 text-xs font-medium transition-all ${
									dateRangeType === 'daily' 
										? 'bg-[var(--primary)] text-white' 
										: 'text-gray-700 hover:bg-gray-50'
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
								className={`px-4 py-2 text-xs font-medium transition-all ${
									dateRangeType === 'weekly' 
										? 'bg-[var(--primary)] text-white' 
										: 'text-gray-700 hover:bg-gray-50'
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
								className={`px-4 py-2 text-xs font-medium transition-all ${
									dateRangeType === 'monthly' 
										? 'bg-[var(--primary)] text-white' 
										: 'text-gray-700 hover:bg-gray-50'
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
								className={`px-4 py-2 text-xs font-medium transition-all ${
									dateRangeType === 'custom' 
										? 'bg-[var(--primary)] text-white' 
										: 'text-gray-700 hover:bg-gray-50'
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
									className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
								/>
								<span className="text-sm text-gray-600">to</span>
								<input 
									type="date" 
									value={endDate}
									onChange={(e) => setEndDate(e.target.value)}
									min={startDate || undefined}
									max={new Date().toISOString().split('T')[0]}
									className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
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
								className="text-gray-600 hover:text-gray-900"
							>
								Clear
							</Button>
						)}
					</div>

					{/* Cards */}
					{error ? (
						<div className="flex items-center justify-center py-8">
							<div className="text-center">
								<AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
								<p className="text-red-600 font-medium">{error}</p>
								<Button 
									variant="outline" 
									onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
										e.preventDefault();
										refreshData(true);
									}}
									className="mt-4"
								>
									Try Again
								</Button>
							</div>
						</div>
					) : (loading && !forceRender) ? (
						<div className="flex items-center justify-center py-8">
							<div className="text-center">
								<Loader2 className="h-8 w-8 animate-spin text-gray-500 mx-auto mb-4" />
								<p className="text-gray-600">Loading scans...</p>
							</div>
						</div>
					) : filtered.length === 0 ? (
						<div className="flex items-center justify-center py-8">
							<div className="text-center">
								<p className="text-gray-500 font-medium">No pending scans found.</p>
								<p className="text-gray-400 text-sm mt-1">New scans will appear here when farmers submit them.</p>
							</div>
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table>
								<Thead>
									<Tr>
										<Th className="w-20">Image</Th>
										<Th>Farmer Name</Th>
										<Th>Scan Type</Th>
										<Th>Status</Th>
										<Th>Date Scanned</Th>
										<Th className="text-right">Action</Th>
									</Tr>
								</Thead>
								<Tbody>
									{filtered.map((scan: Scan) => {
										const cropType = scan.scan_type === 'leaf_disease' ? 'Leaf Disease' : 'Fruit Ripeness';
										const farmerName = scan.farmer_profile?.full_name || scan.farmer_profile?.username || 'Unknown Farmer';
										
										// Use scan_uuid as key if available, otherwise combine scan_type and id for uniqueness
										const uniqueKey = scan.scan_uuid || `${scan.scan_type}-${scan.id}`;
										
										return (
											<Tr 
												key={uniqueKey}
												onClick={(): void => setDetailId(scan.id.toString())}
												className="cursor-pointer hover:bg-gray-50 transition-colors duration-150"
											>
											<Td>
												<div className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex-shrink-0">
													{(() => {
														const imageUrl = getScanImageUrlWithFallback(scan);
														const imageKey = scan.scan_uuid || `scan-thumb-${scan.id}`;
														const thumbErrorKey = `thumb-error-${scan.id}-${scan.scan_uuid || 'unknown'}`;
														
														if (!imageUrl) {
															return (
																<div className="w-full h-full flex items-center justify-center bg-gray-100">
																	<AlertCircle className="w-6 h-6 text-gray-400" />
																</div>
															);
														}
														
														return (
															<Image 
																key={imageKey}
																src={imageUrl} 
																alt={`Scan preview - ${scan.scan_type || 'unknown'}`}
																width={64}
																height={64}
																className="w-full h-full object-cover"
																loading="lazy"
																priority={false}
																unoptimized={true}
																onError={(e: React.SyntheticEvent<HTMLImageElement, Event>): void => {
																	// Silently handle image loading errors - log once per unique image
																	throttledErrorLog(thumbErrorKey, `[Validate Page] Thumbnail not available:`, {
																		scan_id: scan.id,
																		scan_uuid: scan.scan_uuid || 'N/A'
																	});
																	// Hide broken image - gray background will show through
																	e.currentTarget.style.display = 'none';
																}}
															/>
														);
													})()}
												</div>
											</Td>
												<Td>
													<div className="flex items-center gap-2">
														{scan.farmer_profile?.profile_picture ? (
															<Image 
																src={scan.farmer_profile.profile_picture} 
																alt="Profile" 
																width={32}
																height={32}
																className="w-8 h-8 rounded-full object-cover flex-shrink-0"
																onError={(e: React.SyntheticEvent<HTMLImageElement, Event>): void => {
																	e.currentTarget.style.display = 'none';
																}}
															/>
														) : (
															<div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 flex-shrink-0">
																{farmerName.charAt(0).toUpperCase()}
															</div>
														)}
														<span className="font-medium text-gray-900 truncate">{farmerName}</span>
													</div>
												</Td>
												<Td>
													<span className="text-sm text-gray-700">{cropType}</span>
												</Td>
												<Td>
													<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
														{scan.status}
													</span>
												</Td>
												<Td>
													<span className="text-sm text-gray-600">{formatDate(scan.created_at)}</span>
												</Td>
												<Td className="text-right" onClick={(e: React.MouseEvent<HTMLTableCellElement>): void => e.stopPropagation()}>
													<Button
														variant="outline"
														size="sm"
														onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
															e.preventDefault();
															e.stopPropagation();
															setDetailId(scan.id.toString());
														}}
														className="flex items-center gap-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 shadow-sm hover:bg-gray-50 hover:text-gray-900 hover:border-gray-400 hover:shadow-md active:bg-gray-100 active:shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
													>
														<Eye className="h-4 w-4 flex-shrink-0" />
														<span className="whitespace-nowrap">View Details</span>
													</Button>
												</Td>
											</Tr>
										);
									})}
								</Tbody>
							</Table>
						</div>
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
					}}>
						<DialogContent className="!max-w-6xl w-[calc(100%-2rem)] max-w-[95vw] p-0 flex flex-col max-h-[95vh] h-[95vh] overflow-hidden bg-white rounded-xl shadow-2xl">
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
								const farmerInitial = farmerName.charAt(0).toUpperCase();
								
								return (
									<>
										{/* Modal Header - Fixed at top */}
										<div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-white to-gray-50 flex-shrink-0 z-10">
											<DialogHeader className="p-0">
												<DialogTitle className="text-xl font-bold text-gray-900">Scan Validation Details</DialogTitle>
												<p className="text-sm text-gray-500 mt-1">Review and validate the scan information</p>
											</DialogHeader>
											<button 
												aria-label="Close" 
												onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
													e.preventDefault();
													setDetailId(null);
												}} 
												className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
											>
												<X className="h-5 w-5" />
											</button>
										</div>

										{/* Scrollable Content - Main scrollable area */}
										<div 
											className="px-6 py-6 overflow-y-auto overflow-x-hidden bg-gray-50 flex-1 min-h-0 scrollable-details-content" 
											style={{ 
												maxHeight: 'calc(95vh - 200px)',
												scrollBehavior: 'smooth',
												WebkitOverflowScrolling: 'touch'
											}}
										>
											<div className="space-y-6">
												{/* Farmer Info Card */}
												<Card className="shadow-md border border-gray-200 bg-white overflow-hidden">
													<CardHeader className="pb-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
														<div className="flex items-center gap-4">
															{selectedScan.farmer_profile?.profile_picture ? (
																<Image 
																	src={selectedScan.farmer_profile.profile_picture} 
																	alt="Profile" 
																	width={56}
																	height={56}
																	className="w-14 h-14 rounded-full object-cover border-2 border-gray-300 shadow-sm"
																	onError={(e: React.SyntheticEvent<HTMLImageElement, Event>): void => {
																		e.currentTarget.style.display = 'none';
																	}}
																/>
															) : (
																<div className="w-14 h-14 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center text-lg font-bold text-gray-600 border-2 border-gray-300 shadow-sm">
																	{farmerInitial}
																</div>
															)}
															<div className="flex-1 min-w-0">
																<CardTitle className="text-lg font-bold text-gray-900 truncate">
																	{farmerName}
																</CardTitle>
																<div className="flex items-center gap-2 mt-1">
																	<p className="text-sm text-gray-600">{formatDate(selectedScan.created_at)}</p>
																	<span className="text-gray-300">•</span>
																	<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-yellow-100 text-yellow-800 border border-yellow-200">
																		{selectedScan.status}
																	</span>
																</div>
															</div>
														</div>
													</CardHeader>
													<CardContent className="pt-6">
														{/* Scan Image */}
														<div className="space-y-3">
															<label className="block text-sm font-medium text-gray-700">Scan Image</label>
															<div className="aspect-video w-full bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl overflow-hidden border border-gray-300 shadow-inner">
																{(() => {
																	// Get all possible image URLs to try multiple extensions
																	const allUrls = getAllPossibleImageUrls(selectedScan);
																	const attemptKey = selectedScan?.scan_uuid || selectedScan?.id?.toString() || 'unknown';
																	const attemptIndex = imageUrlAttempts[attemptKey] || 0;
																	const imageUrl = allUrls.length > 0 && attemptIndex < allUrls.length ? allUrls[attemptIndex] : null;
																	
																	// Capture all scan values as strings for error handler closure
																	const scanUuid = selectedScan?.scan_uuid ? String(selectedScan.scan_uuid) : 'N/A';
																	const scanType = selectedScan?.scan_type ? String(selectedScan.scan_type) : 'N/A';
																	const scanId = selectedScan?.id ? String(selectedScan.id) : 'N/A';
																	const capturedImageUrl = imageUrl ? String(imageUrl) : 'N/A';
																	const errorKey = `image-error-${scanId}-${scanUuid}`;
																	
																	if (!imageUrl || allUrls.length === 0) {
																		return (
																			<div className="flex items-center justify-center h-full">
																				<div className="text-center">
																					<AlertCircle className="h-8 w-8 text-gray-400 mx-auto mb-2" />
																					<p className="text-sm text-gray-500">Image not available</p>
																					{scanUuid !== 'N/A' && (
																						<p className="text-xs text-gray-400 mt-1">UUID: {scanUuid}</p>
																					)}
																					{process.env.NODE_ENV === 'development' && (
																						<p className="text-xs text-gray-400 mt-1">Bucket: scan-images/{scanType === 'leaf_disease' ? 'leaf_scans' : 'fruit_scans'}</p>
																					)}
																				</div>
																			</div>
																		);
																	}
																	
																	// Use scan_uuid as key to force re-render when scan changes
																	const imageKey = `${scanUuid !== 'N/A' ? scanUuid : `scan-${scanId}`}-attempt-${attemptIndex}`;
																	
																	return (
																		<Image 
																			key={imageKey}
																			src={imageUrl} 
																			alt={`Scan preview - ${scanType} - ${scanUuid !== 'N/A' ? scanUuid : scanId}`}
																			width={800}
																			height={450}
																			className="w-full h-full object-contain"
																			unoptimized={true}
																			onError={(e: React.SyntheticEvent<HTMLImageElement, Event>): void => {
																				// Try next URL if available
																				if (attemptIndex < allUrls.length - 1) {
																					setImageUrlAttempts((prev: Record<string, number>): Record<string, number> => ({
																						...prev,
																						[attemptKey]: attemptIndex + 1
																					}));
																					return; // Don't show error yet, try next URL
																				}
																				
																				// All URLs failed - show error
																				throttledErrorLog(errorKey, '[Validate Page] Image not available:', {
																					scan_uuid: scanUuid,
																					scan_type: scanType,
																					scan_id: scanId,
																					tried_urls: allUrls,
																					bucket: `scan-images/${scanType === 'leaf_disease' ? 'leaf_scans' : 'fruit_scans'}`
																				});
																				
																				// Hide the broken image
																				e.currentTarget.style.display = 'none';
																				
																				// Show error placeholder
																				const parent = e.currentTarget.parentElement;
																				if (parent && !parent.querySelector('.image-error-placeholder')) {
																					const placeholder = document.createElement('div');
																					placeholder.className = 'image-error-placeholder flex flex-col items-center justify-center h-full p-4 bg-gray-100';
																					const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
																					svg.setAttribute('class', 'h-8 w-8 text-gray-400 mb-2');
																					svg.setAttribute('fill', 'none');
																					svg.setAttribute('viewBox', '0 0 24 24');
																					svg.setAttribute('stroke', 'currentColor');
																					const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
																					path.setAttribute('stroke-linecap', 'round');
																					path.setAttribute('stroke-linejoin', 'round');
																					path.setAttribute('stroke-width', '2');
																					path.setAttribute('d', 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z');
																					svg.appendChild(path);
																					
																					const p1 = document.createElement('p');
																					p1.className = 'text-sm text-gray-500 text-center';
																					p1.textContent = 'Image not available';
																					
																					const p2 = document.createElement('p');
																					p2.className = 'text-xs text-gray-400 text-center mt-1';
																					p2.textContent = `Bucket: scan-images/${scanType === 'leaf_disease' ? 'leaf_scans' : 'fruit_scans'}`;
																					
																					placeholder.appendChild(svg);
																					placeholder.appendChild(p1);
																					placeholder.appendChild(p2);
																					
																					if (scanUuid !== 'N/A') {
																						const p3 = document.createElement('p');
																						p3.className = 'text-xs text-gray-400 text-center mt-1';
																						p3.textContent = `UUID: ${scanUuid}`;
																						placeholder.appendChild(p3);
																					}
																					
																					parent.appendChild(placeholder);
																				}
																			}}
																			onLoad={(): void => {
																				// Remove error state and reset attempts if image loads successfully
																				errorThrottle.delete(errorKey);
																				setImageUrlAttempts((prev: Record<string, number>): Record<string, number> => {
																					const next: Record<string, number> = { ...prev };
																					delete next[attemptKey];
																					return next;
																				});
																				
																				if (process.env.NODE_ENV === 'development') {
																					console.log('[Validate Page] Image loaded successfully:', {
																						url: capturedImageUrl,
																						scan_uuid: scanUuid,
																						scan_type: scanType,
																						attempt: attemptIndex + 1
																					});
																				}
																			}}
																		/>
																	);
																})()}
															</div>
														</div>
													</CardContent>
												</Card>

												{/* AI Analysis Overview */}
												<Card className="shadow-md border border-gray-200 bg-white">
													<CardHeader className="pb-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
														<CardTitle className="text-lg font-semibold text-gray-900">AI Analysis Overview</CardTitle>
													</CardHeader>
													<CardContent className="pt-6 space-y-4">
														{/* Scan Type */}
														<div className="space-y-2">
															<label className="block text-sm font-medium text-gray-700">Scan Type</label>
															<p className="text-base text-gray-900 bg-gray-50 px-4 py-2.5 rounded-lg border border-gray-200">{cropType}</p>
														</div>
														
														{/* Confidence Level */}
														<div className="space-y-2">
															<label className="block text-sm font-medium text-gray-700">AI Confidence Level</label>
															<p className="text-base text-gray-900 bg-blue-50 px-4 py-2.5 rounded-lg border border-blue-200 text-blue-900">
																{scanDetails.confidence}
															</p>
														</div>
													</CardContent>
												</Card>

												{/* Leaf Disease Details or Fruit Ripeness Details */}
												<Card className="shadow-md border border-gray-200 bg-white">
													<CardHeader className="pb-4 border-b border-gray-200 bg-gradient-to-r from-emerald-50/50 to-white">
														<CardTitle className="text-lg font-semibold text-gray-900">
															{selectedScan.scan_type === 'leaf_disease' ? 'Leaf Disease Details' : 'Fruit Ripeness Details'}
														</CardTitle>
													</CardHeader>
													<CardContent className="pt-6">
														<div className="bg-gray-50 border border-gray-200 rounded-lg px-5 py-4">
															{selectedScan.scan_type === 'leaf_disease' ? (
																<div className="space-y-3 text-base text-gray-900 leading-relaxed">
																	<div>
																		<span className="text-gray-900">Disease: </span>
																		<span className="text-gray-900">{scanDetails.disease}</span>
																	</div>
																	<div>
																		<span className="text-gray-900">Solution: </span>
																		<span className="text-gray-900 whitespace-pre-wrap">
																			{scanDetails.solution || 'No solution available'}
																		</span>
																	</div>
																	<div>
																		<span className="text-gray-900">Recommended Products: </span>
																		<span className="text-gray-900 whitespace-pre-wrap">
																			{scanDetails.recommendedProducts || 'No products recommended'}
																		</span>
																	</div>
																</div>
															) : (
																<div className="space-y-3 text-base text-gray-900 leading-relaxed">
																	<div>
																		<span className="text-gray-900">Ripeness Stage: </span>
																		<span className="text-gray-900">{scanDetails.disease}</span>
																	</div>
																	<div>
																		<span className="text-gray-900">Harvest Recommendation: </span>
																		<span className="text-gray-900 whitespace-pre-wrap">
																			{scanDetails.solution || 'No recommendation.'}
																		</span>
																	</div>
																</div>
															)}
														</div>
													</CardContent>
												</Card>

												{/* Expert Validation Section */}
												<Card className="shadow-md border-2 border-gray-300 bg-white">
													<CardHeader className="pb-4 border-b border-gray-200 bg-gradient-to-r from-emerald-50 to-white">
														<CardTitle className="text-lg font-semibold text-gray-900">Expert Validation</CardTitle>
														<p className="text-sm text-gray-600 mt-1">Review and provide your expert assessment</p>
													</CardHeader>
													<CardContent className="pt-6 space-y-5">
														{/* Disease/Maturity Selection */}
														<div className="space-y-3">
															<label className="block text-sm font-semibold text-gray-900">
																{selectedScan.scan_type === 'leaf_disease' ? 'Select Diagnosis' : 'Select Ripeness Stage'}
																<span className="text-red-500 ml-1">*</span>
															</label>
															{selectedScan.scan_type === 'leaf_disease' ? (
																<select 
																	value={decision[detailId!] ?? ''} 
																	onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => setDecision({...decision, [detailId!]: e.target.value})} 
																	className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-base font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white shadow-sm transition-all"
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
																	className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-base font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-white shadow-sm transition-all"
																>
																	<option value="">Select ripeness stage</option>
																	<option>Immature</option>
																	<option>Mature</option>
																	<option>Overmature</option>
																	<option>Overripe</option>
																</select>
															)}
														</div>

														{/* Notes */}
														<div className="space-y-3">
															<label className="block text-sm font-semibold text-gray-900">Expert Notes (Optional)</label>
															<textarea 
																value={notes[detailId!] ?? ''} 
																onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void => setNotes({...notes, [detailId!]: e.target.value})} 
																placeholder="Add your expert analysis, observations, or additional comments..." 
																className="w-full rounded-lg border-2 border-gray-300 px-4 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-none shadow-sm transition-all"
																rows={4}
															/>
														</div>
													</CardContent>
												</Card>
											</div>
										</div>

										{/* Modal Footer */}
										<div className="bg-white border-t-2 border-gray-200 px-6 py-4 flex-shrink-0 shadow-lg z-10">
											<DialogFooter className="flex flex-row items-center justify-end gap-3 sm:gap-3">
												<Button 
													variant="outline" 
													onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
														e.preventDefault();
														setDetailId(null);
													}}
													className="text-base font-medium text-gray-700 border-2 border-gray-300 hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 transition-all duration-200"
												>
													Cancel
												</Button>
												<Button 
													onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
														e.preventDefault();
														onConfirm(parseInt(detailId));
													}}
													disabled={isConfirmDisabled(parseInt(detailId)) || processingScanId === parseInt(detailId)}
													className="text-base font-semibold bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] active:bg-[var(--primary-700)] disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all duration-200"
													title={isConfirmDisabled(parseInt(detailId)) ? "Confirm is disabled when the selected value differs from the AI prediction. Use Modified instead." : "Confirm the AI prediction is correct"}
												>
													{processingScanId === parseInt(detailId) ? 'Processing...' : 'Confirm'}
												</Button>
												<Button 
													variant="outline" 
													onClick={(e: React.MouseEvent<HTMLButtonElement>): void => {
														e.preventDefault();
														onReject(parseInt(detailId));
													}}
													disabled={!hasDecision(parseInt(detailId)) || processingScanId === parseInt(detailId)}
													className="text-base font-semibold text-gray-700 border-2 border-gray-300 hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
													title={!hasDecision(parseInt(detailId)) ? "Please select a diagnosis first" : "Modify the AI prediction with your selected diagnosis"}
												>
													{processingScanId === parseInt(detailId) ? 'Processing...' : 'Modified'}
												</Button>
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




