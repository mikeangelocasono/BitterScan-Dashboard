"use client";

import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { useMemo, useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import toast from "react-hot-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/components/supabase";
import { Loader2, AlertCircle, X, Eye } from "lucide-react";
import { Scan, SupabaseApiError, isSupabaseApiError, getAiPrediction } from "@/types";
import { useUser } from "@/components/UserContext";
import { useData } from "@/components/DataContext";
import Image from "next/image";

// Format exact timestamp from database (UTC time as stored, no timezone conversion)
// Displays date and time (hours:minutes AM/PM) matching the actual scan time from device
const formatScanDate = (dateString: string): string => {
	try {
		// Parse as UTC to get exact timestamp from database
		const date = new Date(dateString);
		if (isNaN(date.getTime())) return 'Invalid Date';
		
		// Use UTC methods to display exact database timestamp
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const month = monthNames[date.getUTCMonth()];
		const day = date.getUTCDate();
		const year = date.getUTCFullYear();
		
		let hours = date.getUTCHours();
		const minutes = date.getUTCMinutes();
		const ampm = hours >= 12 ? 'PM' : 'AM';
		hours = hours % 12;
		hours = hours ? hours : 12; // 0 should be 12
		const minutesStr = minutes < 10 ? `0${minutes}` : minutes;
		
		return `${month} ${day}, ${year} - ${hours}:${minutesStr} ${ampm}`;
	} catch {
		return 'Invalid Date';
	}
};

const buildSupabaseErrorMessage = (error: SupabaseApiError | null): string => {
	if (!error) return "Unknown error";
	const parts = [error.message, error.details, error.hint].filter(Boolean);
	return parts.length ? parts.join(" • ") : JSON.stringify(error);
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
 * How it works:
 * 1. DataContext subscribes to Supabase Realtime events (INSERT/UPDATE on 'scans' table)
 * 2. When a new scan is inserted with status='Pending Validation', it's added to the scans state
 * 3. This page filters scans for status='Pending Validation' and displays them
 * 4. When a scan is validated/corrected, its status changes to 'Validated'/'Corrected'
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
	const { user } = useUser();
	// Get scans from DataContext - these update automatically via Supabase Realtime subscriptions
	const { scans, loading, error, removeScanFromState, refreshData } = useData();

	// Prevent body scroll when modal is open and fix dialog max-width
	useEffect(() => {
		if (detailId) {
			document.body.style.overflow = 'hidden';
			// Fix dialog wrapper max-width for larger modals
			const timer = setTimeout(() => {
				const dialogWrapper = document.querySelector('[data-open="true"]');
				if (dialogWrapper) {
					(dialogWrapper as HTMLElement).style.maxWidth = '56rem';
					(dialogWrapper as HTMLElement).style.width = 'calc(100% - 2rem)';
				}
			}, 10);
			return () => {
				clearTimeout(timer);
				document.body.style.overflow = '';
			};
		} else {
			document.body.style.overflow = '';
		}
		return () => {
			document.body.style.overflow = '';
		};
	}, [detailId]);

	// Helper function to check if a decision is selected for a scan
	const hasDecision = useCallback((scanId: number): boolean => {
		const decisionValue = decision[scanId.toString()];
		return decisionValue !== undefined && decisionValue !== null && decisionValue.trim() !== '';
	}, [decision]);

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
	const handleValidation = useCallback(async (scanId: number, action: "confirm" | "correct") => {
		if (processingScanId === scanId) return;

		const selectedScan = scans.find(scan => scan.id === scanId);
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
		const note = noteInput && noteInput.trim().length > 0 ? noteInput.trim() : null;
		const correctedInput = decision[scanKey];
		const corrected = correctedInput && correctedInput.trim().length > 0 ? correctedInput.trim() : "";

		if (action === "correct" && !corrected) {
			toast.error("Please select or enter the corrected result.");
			return;
		}

		const expertValidation = action === "confirm" ? selectedScan.ai_prediction : corrected || selectedScan.ai_prediction;
		if (!expertValidation) {
			toast.error("Unable to determine validation result.");
			return;
		}

		const status = action === "confirm" ? "Validated" : "Corrected";
		const timestamp = new Date().toISOString();
		const originalStatus = selectedScan.status;
		let scanUpdated = false;

		const applyScanUpdate = async (payload: Record<string, unknown>) => {
			const { error } = await supabase.from("scans").update(payload).eq("id", scanId);

			if (error) {
				throw error;
			}
		};

		setProcessingScanId(scanId);

		try {
			// Update scan status - this triggers Supabase Realtime UPDATE event
			// DataContext will receive the event and update the scan in state
			const updatePayload: Record<string, unknown> = {
				status,
				updated_at: timestamp,
			};

			await applyScanUpdate(updatePayload);
			scanUpdated = true;

			// Create validation history - this triggers Supabase Realtime INSERT event
			// DataContext will also update the scan status via this event
			const insertPayload = {
				scan_id: scanId,
				expert_id: user.id,
				ai_prediction: selectedScan.ai_prediction,
				expert_validation: expertValidation,
				status,
				validated_at: timestamp,
				expert_comment: note,
			};

			const { error: historyError } = await supabase.from("validation_history").insert(insertPayload);

			if (historyError) {
				if ((historyError as { code?: string }).code === "23505") {
					const { error: updateHistoryError } = await supabase
						.from("validation_history")
						.update(insertPayload)
						.eq("scan_id", scanId)
						.eq("expert_id", user.id);

					if (updateHistoryError) {
						console.error("Error updating validation history:", updateHistoryError);
						throw updateHistoryError;
					}
				} else {
					console.error("Error creating validation history:", historyError);
					throw historyError;
				}
			}

			// Show appropriate alert message based on action
			const successMessage =
				action === "confirm"
					? "A scan has been confirmed."
					: "A scan has been corrected.";
			toast.success(successMessage);
			
			// Remove scan from local state immediately (optimistic update)
			// The real-time subscription will also update it, but this provides instant feedback
			removeScanFromState(scanId);

			// Clear form state
			setDecision(prev => {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { [scanKey]: _, ...rest } = prev;
				return rest;
			});
			setNotes(prev => {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				const { [scanKey]: _, ...rest } = prev;
				return rest;
			});
			if (detailId === scanKey) {
				setDetailId(null);
			}

			// Note: No need to call refreshData() here - real-time subscriptions handle updates automatically
		} catch (err: unknown) {
			if (scanUpdated) {
				const rollbackPayload: Record<string, unknown> = {
					status: originalStatus,
					updated_at: new Date().toISOString(),
				};

				try {
					await applyScanUpdate(rollbackPayload);
				} catch (rollbackError: unknown) {
					console.error("Failed to rollback scan update:", rollbackError);
				}
			}

			console.error(
				action === "confirm" ? "Error confirming validation:" : "Error correcting validation:",
				buildSupabaseErrorMessage(isSupabaseApiError(err) ? err : null)
			);
			toast.error(action === "confirm" ? "Failed to confirm validation" : "Failed to correct validation");
		} finally {
			setProcessingScanId(prev => (prev === scanId ? null : prev));
		}
	}, [processingScanId, scans, user, notes, decision, detailId, removeScanFromState]);

	const onConfirm = useCallback((scanId: number) => handleValidation(scanId, "confirm"), [handleValidation]);
	const onReject = useCallback((scanId: number) => handleValidation(scanId, "correct"), [handleValidation]);

	// Helper function to get date range based on type
	const getDateRange = useCallback((type: typeof dateRangeType) => {
		if (type === 'none') return { start: null, end: null };
		
		const now = new Date();
		now.setHours(23, 59, 59, 999);
		
		if (type === 'daily') {
			const start = new Date(now);
			start.setHours(0, 0, 0, 0);
			return { start, end: now };
		}
		
		if (type === 'weekly') {
			const start = new Date(now);
			const dayOfWeek = start.getDay();
			start.setDate(start.getDate() - dayOfWeek);
			start.setHours(0, 0, 0, 0);
			return { start, end: now };
		}
		
		if (type === 'monthly') {
			const start = new Date(now.getFullYear(), now.getMonth(), 1);
			start.setHours(0, 0, 0, 0);
			return { start, end: now };
		}
		
		// Custom range
		if (startDate && endDate) {
			const start = new Date(startDate);
			start.setHours(0, 0, 0, 0);
			const end = new Date(endDate);
			end.setHours(23, 59, 59, 999);
			return { start, end };
		}
		
		return { start: null, end: null };
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
		const pendingScans = scans.filter(scan => scan.status === 'Pending Validation');
		
		// Early return if no pending scans
		if (!pendingScans.length) return [];
		
		// Apply additional filters (tab type and date range)
		return pendingScans.filter((scan) => {
			const matchesTab = tab === 'leaf' ? scan.scan_type === 'leaf_disease' : scan.scan_type === 'fruit_maturity';
			
			// Apply date range filter
			if (dateRangeType !== 'none') {
				const { start, end } = getDateRange(dateRangeType);
				if (start && end) {
					const scanDate = new Date(scan.created_at);
					if (scanDate < start || scanDate > end) {
						return false;
					}
				}
			}
			
			return matchesTab;
		});
	}, [scans, dateRangeType, tab, getDateRange]);

	// Memoized date formatter - uses accurate local time
	const formatDate = useCallback((dateString: string) => {
		return formatScanDate(dateString);
	}, []);

	// Parse scan result details from scan data
	const parseScanDetails = useCallback((scan: Scan) => {
		// Try to extract from structured fields first
		const disease = getAiPrediction(scan);
		const confidence = scan.confidence;
		const solution = scan.solution;
		const recommendedProducts = scan.recommended_products;

		// Format confidence as "Confidence: X%" (display exact value from database)
		let formattedConfidence = null;
		if (confidence !== null && confidence !== undefined) {
			if (typeof confidence === 'number') {
				formattedConfidence = `Confidence: ${confidence}%`;
			} else {
				formattedConfidence = `Confidence: ${String(confidence)}%`;
			}
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
								onClick={() => setTab('leaf')}
							>
								Leaf Disease
							</button>
							<button 
								className={`px-5 py-2.5 text-sm font-medium transition-all ${
									tab === 'fruit' 
										? 'bg-[var(--primary)] text-white shadow-sm' 
										: 'text-gray-700 hover:bg-gray-50'
								}`} 
								onClick={() => setTab('fruit')}
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
									onClick={() => refreshData(true)}
									className="mt-4"
								>
									Try Again
								</Button>
							</div>
						</div>
					) : loading ? (
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
									{filtered.map((scan) => {
										const cropType = scan.scan_type === 'leaf_disease' ? 'Leaf Disease' : 'Fruit Ripeness';
										const farmerName = scan.farmer_profile?.full_name || scan.farmer_profile?.username || 'Unknown Farmer';
										
										return (
											<Tr key={scan.id}>
												<Td>
													<div className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-50 flex-shrink-0">
														{scan.image_url ? (
															<Image 
																src={scan.image_url} 
																alt="Scan preview" 
																width={64}
																height={64}
																className="w-full h-full object-cover"
																loading="lazy"
																priority={false}
																onError={(e) => {
																	e.currentTarget.style.display = 'none';
																}}
															/>
														) : (
															<div className="flex items-center justify-center h-full text-gray-400 text-xs">
																No image
															</div>
														)}
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
																onError={(e) => {
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
												<Td className="text-right">
													<Button
														variant="outline"
														size="sm"
														onClick={() => setDetailId(scan.id.toString())}
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

					<Dialog open={!!detailId} onOpenChange={(open) => {
						if (!open) setDetailId(null);
					}}>
						<DialogContent className="!max-w-4xl w-[calc(100%-2rem)] p-0 flex flex-col max-h-[90vh] overflow-hidden bg-white rounded-xl shadow-2xl">
							{detailId && (() => {
								const selectedScan = scans.find(scan => scan.id.toString() === detailId);
								if (!selectedScan) {
									return (
										<div className="p-8 text-center">
											<AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
											<p className="text-base font-medium text-gray-900 mb-2">Scan not found</p>
											<p className="text-sm text-gray-500">The scan you&apos;re looking for may have been removed or doesn&apos;t exist.</p>
											<Button 
												variant="outline" 
												onClick={() => setDetailId(null)}
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
										{/* Modal Header */}
										<div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-white to-gray-50 flex-shrink-0">
											<DialogHeader className="p-0">
												<DialogTitle className="text-xl font-bold text-gray-900">Scan Validation Details</DialogTitle>
												<p className="text-sm text-gray-500 mt-1">Review and validate the scan information</p>
											</DialogHeader>
											<button 
												aria-label="Close" 
												onClick={() => setDetailId(null)} 
												className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
											>
												<X className="h-5 w-5" />
											</button>
										</div>

										{/* Scrollable Content */}
										<div className="px-6 py-6 overflow-y-auto bg-gray-50 flex-1 min-h-0" style={{ maxHeight: 'calc(90vh - 180px)' }}>
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
																	onError={(e) => {
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
																{selectedScan.image_url ? (
																	<Image 
																		src={selectedScan.image_url} 
																		alt="Scan preview" 
																		width={800}
																		height={450}
																		className="w-full h-full object-contain"
																		onError={(e) => {
																			e.currentTarget.style.display = 'none';
																		}}
																	/>
																) : (
																	<div className="flex items-center justify-center h-full text-gray-500 text-base font-medium">
																		No image available
																	</div>
																)}
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
																	onChange={(e) => setDecision({...decision, [detailId!]: e.target.value})} 
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
																	onChange={(e) => setDecision({...decision, [detailId!]: e.target.value})} 
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
																onChange={(e) => setNotes({...notes, [detailId!]: e.target.value})} 
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
										<div className="bg-white border-t-2 border-gray-200 px-6 py-4 flex-shrink-0 shadow-lg">
											<DialogFooter className="flex flex-row items-center justify-end gap-3 sm:gap-3">
												<Button 
													variant="outline" 
													onClick={() => setDetailId(null)}
													className="text-base font-medium text-gray-700 border-2 border-gray-300 hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 transition-all duration-200"
												>
													Cancel
												</Button>
												<Button 
													onClick={() => onConfirm(parseInt(detailId))}
													disabled={hasDecision(parseInt(detailId)) || processingScanId === parseInt(detailId)}
													className="text-base font-semibold bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] active:bg-[var(--primary-700)] disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg transition-all duration-200"
												>
													{processingScanId === parseInt(detailId) ? 'Processing...' : 'Confirm'}
												</Button>
												<Button 
													variant="outline" 
													onClick={() => onReject(parseInt(detailId))}
													disabled={!hasDecision(parseInt(detailId)) || processingScanId === parseInt(detailId)}
													className="text-base font-semibold text-gray-700 border-2 border-gray-300 hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
												>
													{processingScanId === parseInt(detailId) ? 'Processing...' : 'Correct'}
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


