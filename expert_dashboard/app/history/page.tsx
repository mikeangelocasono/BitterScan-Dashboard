"use client";

import AppShell from "@/components/AppShell";
import AuthGuard from "@/components/AuthGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/table";
import Badge from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMemo, useState, useCallback, useEffect } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import toast from "react-hot-toast";
import { supabase } from "@/components/supabase";
import { Loader2, AlertCircle, Trash2, X, Download, Calendar, Camera, CheckCircle2, Activity } from "lucide-react";
import { useUser } from "@/components/UserContext";
import { useData } from "@/components/DataContext";
import { getAiPrediction } from "@/types";
import type { Scan } from "@/types";
import Image from "next/image";
import { getScanImageUrlWithFallback } from "@/utils/imageUtils";
import { formatDate as formatDateUtil, formatScanType, getStatusBadgeColor, getDateRange } from "@/utils/dateUtils";

// Types for Supabase responses
type ProfileData = {
	id: string;
	full_name?: string | null;
	username?: string | null;
	email?: string | null;
};

type LeafScanData = {
	scan_uuid: string;
	farmer_id?: string | null;
	expert_comment?: string | null;
	scan_type?: 'leaf_disease';
};

type FruitScanData = {
	scan_uuid: string;
	farmer_id?: string | null;
	expert_comment?: string | null;
	scan_type?: 'fruit_maturity';
};

type ValidationHistoryRecord = {
	id: number;
	scan_id: string;
	expert_id: string;
	expert_name?: string | null;
	ai_prediction: string;
	expert_validation?: string | null;
	expert_comment?: string | null;
	status: 'Validated' | 'Corrected';
	validated_at: string;
	scan?: Scan | null;
	farmerName?: string;
	expertName?: string;
};


export default function HistoryPage() {
	const [dateRangeType, setDateRangeType] = useState<'daily' | 'weekly' | 'monthly' | 'custom' | 'none'>('none');
	const [startDate, setStartDate] = useState<string>("");
	const [endDate, setEndDate] = useState<string>("");
	const [showAll, setShowAll] = useState(false);
	const [detailIdx, setDetailIdx] = useState<number | null>(null);
	const [deleteIdx, setDeleteIdx] = useState<number | null>(null);
	const [deleteLoading, setDeleteLoading] = useState(false);
	// Force render after timeout to prevent infinite loading
	const [forceRender, setForceRender] = useState(false);
	const { user } = useUser();
	const { scans, validationHistory, loading, error, refreshData } = useData();

	// Master timeout: force render after 6 seconds to prevent infinite loading
	useEffect(() => {
		const timeout = setTimeout(() => {
			if (!forceRender && loading) {
				console.warn('[HistoryPage] Forcing render after timeout');
				setForceRender(true);
			}
		}, 6000);
		return () => clearTimeout(timeout);
	}, [forceRender, loading]);

	// Helper function to get date range based on type
	const getDateRangeForFilter = useCallback((type: typeof dateRangeType) => {
		return getDateRange(type, startDate, endDate);
	}, [startDate, endDate]);

	// Filter scans to exclude only Unknown scans (no date filtering)
	// This is used for Total Scans and Total Validated cards to show ALL scans
	// Real-time updates will immediately reflect new scans regardless of date filter
	const allValidScans = useMemo(() => {
		if (!scans || scans.length === 0) return [];
		
		// Filter out Unknown scans only (no date filtering)
		return scans.filter(scan => {
			// Exclude scans with status = 'Unknown' (type assertion for runtime check)
			if ((scan.status as string) === 'Unknown') return false;
			// Exclude scans with result = 'Unknown' (disease_detected or ripeness_stage)
			const result = getAiPrediction(scan);
			if (result === 'Unknown') return false;
			return true;
		});
	}, [scans]);

	// Filter scans based on date range (for displayed records list)
	// This respects the selected date filter for the records table
	const filteredScans = useMemo(() => {
		if (!allValidScans || allValidScans.length === 0) return [];
		
		// If no filter is selected, return all valid scans
		if (dateRangeType === 'none') {
			return allValidScans;
		}
		
		const { start, end } = getDateRangeForFilter(dateRangeType);
		if (!start || !end) {
			return allValidScans;
		}
		
		const startTime = start.getTime();
		const endTime = end.getTime();
		
		// Apply date range filtering for the records list
		return allValidScans.filter(scan => {
			if (!scan.created_at) return false;
			try {
				const scanDate = new Date(scan.created_at);
				if (isNaN(scanDate.getTime())) return false;
				const scanTime = scanDate.getTime();
				return scanTime >= startTime && scanTime <= endTime;
			} catch {
				return false;
			}
		});
	}, [allValidScans, dateRangeType, getDateRange]);

	// Filter validation history based on date range
	// This ensures the report only includes records that match the selected filter
	const filtered = useMemo(() => {
		// If no filter is selected, return all records
		if (dateRangeType === 'none') {
			return validationHistory;
		}
		
		// Get the date range based on the selected filter type
		const { start, end } = getDateRangeForFilter(dateRangeType);
		if (!start || !end) {
			return validationHistory;
		}
		
		// Convert dates to timestamps for comparison
		const startTime = start.getTime();
		const endTime = end.getTime();
		
		// Filter records by validated_at date to match the selected range
		return validationHistory.filter(record => {
			if (!record.validated_at) return false;
			try {
				const recordDate = new Date(record.validated_at);
				if (isNaN(recordDate.getTime())) return false;
				const recordTime = recordDate.getTime();
				// Include records where validated_at is within the selected date range
				return recordTime >= startTime && recordTime <= endTime;
			} catch {
				return false;
			}
		});
	}, [validationHistory, dateRangeType, getDateRange, startDate, endDate]);

	// Memoized date formatter
	const formatDate = useCallback((dateString: string) => {
		return formatDateUtil(dateString);
	}, []);

	// Reset showAll when filter changes
	useEffect(() => {
		setShowAll(false);
	}, [dateRangeType, startDate, endDate]);

	// Paginated records - show 5 by default, all when "See More" is clicked
	const displayedRecords = useMemo(() => {
		if (showAll) {
			return filtered;
		}
		return filtered.slice(0, 5);
	}, [filtered, showAll]);

	const hasMoreRecords = useMemo(() => {
		return filtered.length > 5;
	}, [filtered]);

	// CSV escaping function to handle commas, quotes, and newlines
	const escapeCSV = useCallback((value: string | number | null | undefined): string => {
		if (value === null || value === undefined) return '';
		const str = String(value);
		// If value contains comma, quote, or newline, wrap in quotes and escape quotes
		if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
			return `"${str.replace(/"/g, '""')}"`;
		}
		return str;
	}, []);


	// Handle delete validation record
	const handleDelete = useCallback(async () => {
		if (deleteIdx === null) return;
		const record = filtered[deleteIdx];
		if (!record || !user) return;

		// Check if user is the expert who created this validation
		if (record.expert_id !== user.id) {
			toast.error("You can only delete your own validations.");
			setDeleteIdx(null);
			return;
		}

		setDeleteLoading(true);
		try {
			// Get the scan UUID from the record (scan_id is now UUID in validation_history)
			const scanUuid = record.scan_id;
			const scanId = record.scan?.id; // Numeric ID for updating scan table

			// Delete the validation history record using the numeric ID
			const { error: deleteError } = await supabase
				.from('validation_history')
				.delete()
				.eq('id', record.id);

			if (deleteError) {
				if (process.env.NODE_ENV === 'development') {
					console.error('Delete error:', deleteError);
				}
				throw deleteError;
			}

			// Close detail modal if the deleted record is being viewed
			if (detailIdx !== null && detailIdx === deleteIdx) {
				setDetailIdx(null);
			}

			// Revert scan status to pending if it was validated
			// Check if scan's current status is NOT "Pending Validation" (i.e., it was validated)
			if (scanUuid && record.scan && record.scan.status && record.scan.status !== 'Pending Validation') {
				// Determine which table to update based on scan_type
				const tableName = record.scan.scan_type === 'leaf_disease' 
					? 'leaf_disease_scans' 
					: 'fruit_ripeness_scans';
				
				// Try using scan_uuid first (UUID field)
				if (record.scan.scan_uuid) {
					const { error: scanUpdateError } = await supabase
						.from(tableName)
						.update({
							status: 'Pending Validation',
							expert_comment: null,
							updated_at: new Date().toISOString()
						})
						.eq('scan_uuid', record.scan.scan_uuid);
					
					if (scanUpdateError) {
						if (process.env.NODE_ENV === 'development') {
							console.error('Error reverting scan status:', scanUpdateError);
						}
						// Don't throw - deletion was successful, scan update is optional
					}
				} else if (scanId) {
					// Fallback to numeric ID
					const { error: scanUpdateError } = await supabase
						.from(tableName)
						.update({
							status: 'Pending Validation',
							expert_comment: null,
							updated_at: new Date().toISOString()
						})
						.eq('id', scanId);
					
					if (scanUpdateError) {
						if (process.env.NODE_ENV === 'development') {
							console.error('Error reverting scan status:', scanUpdateError);
						}
						// Don't throw - deletion was successful, scan update is optional
					}
				}
			}

			toast.success("Validation record deleted successfully");
			setDeleteIdx(null);
			
			// Refresh data to ensure UI is in sync (realtime will also update, but this ensures consistency)
			await refreshData();
		} catch (err: unknown) {
			if (process.env.NODE_ENV === 'development') {
				console.error('Error deleting validation:', err);
			}
			const errorMessage = err instanceof Error ? err.message : 'Failed to delete validation record';
			toast.error(errorMessage);
		} finally {
			setDeleteLoading(false);
		}
	}, [deleteIdx, filtered, user, refreshData, detailIdx]);

	// Calculate statistics from ALL scans (not filtered by date range)
	// These update automatically when scans are added/updated via real-time subscriptions
	// Total Scans: Total number of ALL valid scans (excluding only Unknown)
	// Uses allValidScans to ensure new scans are immediately counted regardless of date filter
	const totalRecords = useMemo(() => {
		if (!allValidScans || allValidScans.length === 0) return 0;
		return allValidScans.length;
	}, [allValidScans]);
	
	// Total Validated: Count of ALL scans that are NOT "Pending Validation"
	// A scan is considered validated if its status is NOT "Pending Validation"
	// This includes scans with status "Validated", "Confirmed", "Corrected", or any other non-pending status
	// Uses allValidScans to ensure new validations are immediately counted regardless of date filter
	const totalValidated = useMemo(() => {
		if (!allValidScans || allValidScans.length === 0) return 0;
		return allValidScans.filter(scan => scan.status !== 'Pending Validation').length;
	}, [allValidScans]);
	
	// Validation Rate: Percentage of scans that have been validated
	// Formula: (Total Validated Scans / Total Scans) × 100
	const validationRate = useMemo(() => {
		if (totalRecords === 0) return '0.0';
		const rate = (totalValidated / totalRecords) * 100;
		return rate.toFixed(1);
	}, [totalValidated, totalRecords]);
	
	// Expert Corrections: Number of scans that were corrected by experts
	// Count from filtered validation_history based on date range
	const correctedRecords = useMemo(() => {
		return filtered.filter(v => v.status === 'Corrected').length;
	}, [filtered]);

	return (
		<AuthGuard>
			<AppShell>
				<div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
					<div className="no-print">
						<h1 className="text-3xl font-bold text-gray-900 tracking-tight">History</h1>
					</div>
					<div className="print-only" style={{ display: 'none' }}>
						<h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-2">Validation History Report</h1>
						<p className="text-sm text-gray-600 mb-4">
							Generated on {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
							{dateRangeType !== 'none' && (
								<span>
									{dateRangeType === 'custom' && startDate && endDate
										? ` • Filtered: ${startDate} to ${endDate}`
										: dateRangeType === 'daily'
										? ` • Filtered: Today`
										: dateRangeType === 'weekly'
										? ` • Filtered: This Week`
										: dateRangeType === 'monthly'
										? ` • Filtered: This Month`
										: ` • Filtered: ${dateRangeType.charAt(0).toUpperCase() + dateRangeType.slice(1)}`
									}
								</span>
							)}
						</p>
					</div>

					{/* Stats */}
					<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
						<Card className="shadow-sm hover:shadow-md transition-all duration-200">
							<CardHeader className="pb-2 pt-4">
								<CardTitle className="flex items-center justify-between">
									<span className="text-sm font-semibold text-gray-700">Total Scans</span>
									<div className="p-1.5 rounded-lg bg-blue-50">
										<Camera className="h-4 w-4 text-blue-600" />
									</div>
								</CardTitle>
							</CardHeader>
							<CardContent className="pb-4">
								<p className="text-2xl font-bold text-gray-900">{totalRecords.toLocaleString("en-US")}</p>
							</CardContent>
						</Card>
						<Card className="shadow-sm hover:shadow-md transition-all duration-200">
							<CardHeader className="pb-2 pt-4">
								<CardTitle className="flex items-center justify-between">
									<span className="text-sm font-semibold text-gray-700">Total Validated</span>
									<div className="p-1.5 rounded-lg bg-green-50">
										<CheckCircle2 className="h-4 w-4 text-green-600" />
									</div>
								</CardTitle>
							</CardHeader>
							<CardContent className="pb-4">
								<p className="text-2xl font-bold text-gray-900">{totalValidated.toLocaleString("en-US")}</p>
							</CardContent>
						</Card>
						<Card className="shadow-sm hover:shadow-md transition-all duration-200">
							<CardHeader className="pb-2 pt-4">
								<CardTitle className="flex items-center justify-between">
									<span className="text-sm font-semibold text-gray-700">Validation Rate</span>
									<div className="p-1.5 rounded-lg bg-purple-50">
										<Activity className="h-4 w-4 text-purple-600" />
									</div>
								</CardTitle>
							</CardHeader>
							<CardContent className="pb-4">
								<p className="text-2xl font-bold text-gray-900">{validationRate}%</p>
							</CardContent>
						</Card>
						<Card className="shadow-sm hover:shadow-md transition-all duration-200">
							<CardHeader className="pb-2 pt-4">
								<CardTitle className="flex items-center justify-between">
									<span className="text-sm font-semibold text-gray-700">Expert Corrections</span>
									<div className="p-1.5 rounded-lg bg-orange-50">
										<AlertCircle className="h-4 w-4 text-orange-600" />
									</div>
								</CardTitle>
							</CardHeader>
							<CardContent className="pb-4">
								<p className="text-2xl font-bold text-gray-900">{correctedRecords.toLocaleString("en-US")}</p>
							</CardContent>
						</Card>
					</div>

					{/* Date Range Filter */}
					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-sm font-medium text-gray-700 flex items-center gap-2">
								<Calendar className="h-4 w-4" />
								Time Period:
							</span>
							<div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
								<Button
									variant={dateRangeType === 'daily' ? "default" : "ghost"}
									size="sm"
									className={`text-sm font-medium transition-colors ${
										dateRangeType === 'daily'
											? 'bg-[#388E3C] text-white hover:bg-[#2F7A33]'
											: 'text-gray-700 hover:bg-gray-100'
									}`}
									onClick={() => {
										setDateRangeType('daily');
										setStartDate("");
										setEndDate("");
									}}
								>
									Today
								</Button>
								<Button
									variant={dateRangeType === 'weekly' ? "default" : "ghost"}
									size="sm"
									className={`text-sm font-medium transition-colors ${
										dateRangeType === 'weekly'
											? 'bg-[#388E3C] text-white hover:bg-[#2F7A33]'
											: 'text-gray-700 hover:bg-gray-100'
									}`}
									onClick={() => {
										setDateRangeType('weekly');
										setStartDate("");
										setEndDate("");
									}}
								>
									This Week
								</Button>
								<Button
									variant={dateRangeType === 'monthly' ? "default" : "ghost"}
									size="sm"
									className={`text-sm font-medium transition-colors ${
										dateRangeType === 'monthly'
											? 'bg-[#388E3C] text-white hover:bg-[#2F7A33]'
											: 'text-gray-700 hover:bg-gray-100'
									}`}
									onClick={() => {
										setDateRangeType('monthly');
										setStartDate("");
										setEndDate("");
									}}
								>
									This Month
								</Button>
							</div>
							<Button
								variant={dateRangeType === 'custom' ? "default" : "outline"}
								size="sm"
								className={`text-sm font-medium transition-colors ${
									dateRangeType === 'custom'
										? 'bg-[#388E3C] text-white hover:bg-[#2F7A33]'
										: 'border-gray-300 hover:bg-gray-50'
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
								<Calendar className="h-4 w-4 mr-1.5" />
								Custom
							</Button>
							{dateRangeType === 'custom' && (
								<div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
									<input
										type="date"
										value={startDate}
										onChange={(e) => setStartDate(e.target.value)}
										max={endDate || new Date().toISOString().split('T')[0]}
										className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-colors"
									/>
									<span className="text-gray-500 font-medium text-sm">to</span>
									<input
										type="date"
										value={endDate}
										onChange={(e) => setEndDate(e.target.value)}
										min={startDate || undefined}
										max={new Date().toISOString().split('T')[0]}
										className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-[#388E3C] focus:border-transparent transition-colors"
									/>
									{startDate && endDate && (
										<span className="text-xs text-gray-600 font-medium ml-1">
											({new Date(startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {new Date(endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})
										</span>
									)}
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
									className="text-sm text-gray-600 hover:text-gray-900"
								>
									<X className="h-4 w-4 mr-1.5" />
									Clear Filter
								</Button>
							)}
						</div>
						
						{/* Export Buttons */}
						<div className="flex gap-2 no-print">
							<Button 
								variant="outline" 
								size="sm"
								onClick={async () => {
										try {
											const loadingToast = toast.loading('Fetching data from database...');
											
											// Get date range for filtering
											const { start, end } = getDateRangeForFilter(dateRangeType);
											
											// Build query to fetch validation_history directly from database
											let query = supabase
												.from('validation_history')
												.select('*')
												.order('validated_at', { ascending: false });
											
											// Apply date filter at database level
											if (start && end) {
												query = query
													.gte('validated_at', start.toISOString())
													.lte('validated_at', end.toISOString());
											}
											
											const { data: records, error: fetchError } = await query;
											
											// Fetch related scan data, farmer profiles, and expert profiles separately
											if (records && records.length > 0) {
												const scanUuids = records.map(r => String(r.scan_id).trim()).filter(Boolean);
												const farmerIds = new Set<string>();
												const expertIds = new Set<string>();
												
												// Collect expert IDs
												records.forEach((record: ValidationHistoryRecord) => {
													if (record.expert_id) expertIds.add(record.expert_id);
												});
												
												// Create a map of scan_uuid to scan data
												const scanMap = new Map();
												
												if (scanUuids.length > 0) {
													// Fetch from both scan tables (each table has different fields)
													const [leafScansResponse, fruitScansResponse] = await Promise.all([
														supabase.from('leaf_disease_scans').select('scan_uuid, farmer_id, expert_comment').in('scan_uuid', scanUuids),
														supabase.from('fruit_ripeness_scans').select('scan_uuid, farmer_id, expert_comment').in('scan_uuid', scanUuids)
													]);
													
													const leafScans = leafScansResponse.data || [];
													const fruitScans = fruitScansResponse.data || [];
													
													// Process leaf disease scans - normalize UUIDs to lowercase for consistent matching
													leafScans.forEach((scan: LeafScanData) => {
														if (scan && scan.scan_uuid) {
															const normalizedUuid = String(scan.scan_uuid).trim().toLowerCase();
															scanMap.set(normalizedUuid, { 
																...scan, 
																scan_type: 'leaf_disease',
																farmer_id: scan.farmer_id 
															});
															if (scan.farmer_id) farmerIds.add(scan.farmer_id);
														}
													});
													
													// Process fruit ripeness scans - normalize UUIDs to lowercase for consistent matching
													fruitScans.forEach((scan: FruitScanData) => {
														if (scan && scan.scan_uuid) {
															const normalizedUuid = String(scan.scan_uuid).trim().toLowerCase();
															scanMap.set(normalizedUuid, { 
																...scan, 
																scan_type: 'fruit_maturity',
																farmer_id: scan.farmer_id 
															});
															if (scan.farmer_id) farmerIds.add(scan.farmer_id);
														}
													});
													
													// Attach scan data to records - normalize UUID to lowercase for matching
													records.forEach((record: ValidationHistoryRecord) => {
														const scanId = record.scan_id;
														if (!scanId) {
															record.scan = null;
															return;
														}
														
														// Normalize UUID to lowercase for consistent matching
														const normalizedUuid = String(scanId).trim().toLowerCase();
														const scan = scanMap.get(normalizedUuid);
														
														if (scan) {
															record.scan = scan;
														} else {
															// If scan not found, try to determine scan_type from AI prediction
															// Leaf diseases typically have specific names, fruit ripeness has stages
															const aiPred = (record.ai_prediction || '').toLowerCase();
															const isFruitRipeness = ['immature', 'mature', 'overmature', 'overripe'].some(stage => aiPred.includes(stage));
															record.scan = {
																scan_type: isFruitRipeness ? 'fruit_maturity' : 'leaf_disease',
																farmer_id: '',
																expert_comment: undefined
															} as Scan;
														}
													});
												}
												
												// Fetch farmer and expert profiles from profiles table
												// Use expert_name from validation_history table if available, otherwise fetch from profiles
												const [farmerProfilesResponse, expertProfilesResponse] = await Promise.all([
													farmerIds.size > 0 ? supabase.from('profiles').select('id, full_name, username, email').in('id', Array.from(farmerIds)) : Promise.resolve({ data: [], error: null }),
													expertIds.size > 0 ? supabase.from('profiles').select('id, full_name, username, email').in('id', Array.from(expertIds)) : Promise.resolve({ data: [], error: null })
												]);
												
												// Create maps for quick lookup - prioritize full_name, fallback to username
												// Use normalized (lowercase) IDs for case-insensitive matching to ensure we find profiles even with case mismatches
												const farmerMap = new Map<string, string>();
												(farmerProfilesResponse.data || []).forEach((profile: ProfileData) => {
													if (profile && profile.id) {
														// Normalize ID to lowercase for consistent matching (UUIDs can have case variations)
														const normalizedId = String(profile.id).trim().toLowerCase();
														// Get farmer name: prioritize full_name, fallback to username
														const farmerName = (profile.full_name && profile.full_name.trim()) 
															|| (profile.username && profile.username.trim()) 
															|| 'N/A';
														// Store with normalized ID (primary key for lookups)
														farmerMap.set(normalizedId, farmerName);
														// Also store with original case as fallback
														farmerMap.set(String(profile.id).trim(), farmerName);
													}
												});
												
												const expertMap = new Map<string, string>();
												(expertProfilesResponse.data || []).forEach((profile: ProfileData) => {
													if (profile && profile.id) {
														// Normalize ID to lowercase for consistent matching
														const normalizedId = String(profile.id).trim().toLowerCase();
														const expertName = (profile.full_name && profile.full_name.trim()) 
															|| (profile.username && profile.username.trim()) 
															|| 'N/A';
														// Store with normalized ID (primary key for lookups)
														expertMap.set(normalizedId, expertName);
														// Also store with original case as fallback
														expertMap.set(String(profile.id).trim(), expertName);
													}
												});
												
												// Attach profile data to records - fetch farmer name from validation_history context
												records.forEach((record: ValidationHistoryRecord) => {
													const scan = record.scan;
													
													// Fetch farmer name from scan's farmer_id -> profiles table
													// Normalize farmer_id for case-insensitive matching to ensure we find the profile
													if (scan && scan.farmer_id) {
														const normalizedFarmerId = String(scan.farmer_id).trim().toLowerCase();
														// Try normalized ID first (most common case), then original ID as fallback
														const farmerName = farmerMap.get(normalizedFarmerId) 
															|| farmerMap.get(String(scan.farmer_id).trim())
															|| 'N/A';
														record.farmerName = farmerName;
													} else {
														record.farmerName = 'N/A';
													}
													
													// Fetch expert name - use expert_name from validation_history if available, otherwise lookup from profiles
													if (record.expert_name && record.expert_name.trim()) {
														record.expertName = record.expert_name.trim();
													} else if (record.expert_id) {
														const normalizedExpertId = String(record.expert_id).trim().toLowerCase();
														record.expertName = expertMap.get(normalizedExpertId) 
															|| expertMap.get(String(record.expert_id).trim())
															|| 'N/A';
													} else {
														record.expertName = 'N/A';
													}
													
													// Ensure scan_type is set
													if (!scan || !scan.scan_type) {
														// Try to infer from AI prediction
														const aiPred = (record.ai_prediction || '').toLowerCase();
														const isFruitRipeness = ['immature', 'mature', 'overmature', 'overripe'].some(stage => aiPred.includes(stage));
														if (!scan) {
															record.scan = {
																id: 0,
																farmer_id: '',
																scan_type: isFruitRipeness ? 'fruit_maturity' : 'leaf_disease',
																image_url: '',
																status: 'Pending Validation',
																created_at: '',
																updated_at: '',
																scan_uuid: ''
															} as Scan;
														} else {
															scan.scan_type = isFruitRipeness ? 'fruit_maturity' : 'leaf_disease';
														}
													}
												});
											}
											
											if (fetchError) {
												toast.dismiss(loadingToast);
												throw fetchError;
											}
											
											if (!records || records.length === 0) {
												toast.dismiss(loadingToast);
												toast.error('No records found for the selected period');
												return;
											}
											
											// Filter out Unknown records
											const validRecords = records.filter((record: ValidationHistoryRecord) => {
												// Exclude if scan has Unknown status
												if (record.scan && record.scan.status === 'Unknown') return false;
												// Exclude if AI prediction is Unknown
												if (record.ai_prediction === 'Unknown') return false;
												// Exclude if expert validation is Unknown
												if (record.expert_validation === 'Unknown') return false;
												// Exclude if disease_detected or ripeness_stage is Unknown
												const scan = record.scan;
												if (scan) {
													if (scan.disease_detected === 'Unknown' || scan.ripeness_stage === 'Unknown') return false;
												}
												return true;
											});
											
											// CSV Headers - required fields as per requirements (Farmer Name excluded)
											const headers = [
												'Scan Type',
												'Expert Name',
												'AI Prediction',
												'Expert Validation',
												'Status',
												'Validated At',
												'Expert Comment'
											];

											// Build CSV rows with required fields (Farmer Name excluded)
											const rows = validRecords.map((record: ValidationHistoryRecord) => {
												const scan = record.scan;
												// Determine scan type - check scan object first, then try to infer from AI prediction
												let scanType = 'N/A';
												if (scan && scan.scan_type) {
													scanType = scan.scan_type === 'leaf_disease' ? 'Leaf Disease' 
														: scan.scan_type === 'fruit_maturity' ? 'Fruit Maturity' 
														: 'N/A';
												} else if (record.ai_prediction) {
													// Try to infer from AI prediction
													const aiPred = (record.ai_prediction || '').toLowerCase();
													const isFruitRipeness = ['immature', 'mature', 'overmature', 'overripe'].some(stage => aiPred.includes(stage));
													scanType = isFruitRipeness ? 'Fruit Maturity' : 'Leaf Disease';
												}
												
												const aiPrediction = record.ai_prediction || 'N/A';
												const expertValidation = record.expert_validation || 'N/A';
												const status = record.status || 'N/A';
												const validatedAt = record.validated_at ? formatDate(record.validated_at) : 'N/A';
												const expertComment = scan?.expert_comment || record.expert_comment || 'N/A';
												const expertName = record.expertName || 'N/A';

												return [
													escapeCSV(scanType),
													escapeCSV(expertName),
													escapeCSV(aiPrediction),
													escapeCSV(expertValidation),
													escapeCSV(status),
													escapeCSV(validatedAt),
													escapeCSV(expertComment)
												].join(',');
											});

											// Combine headers and rows
											const csvContent = [headers.join(','), ...rows].join('\n');
											
											// Add BOM for UTF-8 to ensure proper Excel compatibility
											const BOM = '\uFEFF';
											const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
											const url = URL.createObjectURL(blob);
											const a = document.createElement('a');
											a.href = url;
											a.download = `validation-history-${new Date().toISOString().split('T')[0]}.csv`;
											document.body.appendChild(a);
											a.click();
											document.body.removeChild(a);
											URL.revokeObjectURL(url);
											
											toast.dismiss(loadingToast);
											toast.success(`CSV exported (${validRecords.length} records)`);
										} catch (error: unknown) {
											if (process.env.NODE_ENV === 'development') {
												console.error('Error exporting CSV:', error);
											}
											toast.error('Failed to export CSV');
										}
									}}
									className="flex items-center gap-2"
								>
									<Download className="h-4 w-4" />
									Export CSV
								</Button>
								<Button 
									size="sm"
									onClick={async () => {
										try {
											const loadingToast = toast.loading('Generating PDF...');
											
											// Get date range for filtering
											const { start, end } = getDateRangeForFilter(dateRangeType);
											
											// Build query to fetch validation_history directly from database
											let query = supabase
												.from('validation_history')
												.select('*')
												.order('validated_at', { ascending: false });
											
											// Apply date filter at database level
											if (start && end) {
												query = query
													.gte('validated_at', start.toISOString())
													.lte('validated_at', end.toISOString());
											}
											
											const { data: records, error: fetchError } = await query;
											
											// Fetch related scan data, farmer profiles, and expert profiles separately
											if (records && records.length > 0) {
												const scanUuids = records.map(r => String(r.scan_id).trim()).filter(Boolean);
												const farmerIds = new Set<string>();
												const expertIds = new Set<string>();
												
												// Collect expert IDs
												records.forEach((record: ValidationHistoryRecord) => {
													if (record.expert_id) expertIds.add(record.expert_id);
												});
												
												// Create a map of scan_uuid to scan data
												const scanMap = new Map();
												
												if (scanUuids.length > 0) {
													// Fetch from both scan tables (each table has different fields)
													const [leafScansResponse, fruitScansResponse] = await Promise.all([
														supabase.from('leaf_disease_scans').select('scan_uuid, farmer_id, expert_comment').in('scan_uuid', scanUuids),
														supabase.from('fruit_ripeness_scans').select('scan_uuid, farmer_id, expert_comment').in('scan_uuid', scanUuids)
													]);
													
													const leafScans = leafScansResponse.data || [];
													const fruitScans = fruitScansResponse.data || [];
													
													// Process leaf disease scans - normalize UUIDs to lowercase for consistent matching
													leafScans.forEach((scan: LeafScanData) => {
														if (scan && scan.scan_uuid) {
															const normalizedUuid = String(scan.scan_uuid).trim().toLowerCase();
															scanMap.set(normalizedUuid, { 
																...scan, 
																scan_type: 'leaf_disease',
																farmer_id: scan.farmer_id 
															});
															if (scan.farmer_id) farmerIds.add(scan.farmer_id);
														}
													});
													
													// Process fruit ripeness scans - normalize UUIDs to lowercase for consistent matching
													fruitScans.forEach((scan: FruitScanData) => {
														if (scan && scan.scan_uuid) {
															const normalizedUuid = String(scan.scan_uuid).trim().toLowerCase();
															scanMap.set(normalizedUuid, { 
																...scan, 
																scan_type: 'fruit_maturity',
																farmer_id: scan.farmer_id 
															});
															if (scan.farmer_id) farmerIds.add(scan.farmer_id);
														}
													});
													
													// Attach scan data to records - normalize UUID to lowercase for matching
													records.forEach((record: ValidationHistoryRecord) => {
														const scanId = record.scan_id;
														if (!scanId) {
															record.scan = null;
															return;
														}
														
														// Normalize UUID to lowercase for consistent matching
														const normalizedUuid = String(scanId).trim().toLowerCase();
														const scan = scanMap.get(normalizedUuid);
														
														if (scan) {
															record.scan = scan;
														} else {
															// If scan not found, try to determine scan_type from AI prediction
															// Leaf diseases typically have specific names, fruit ripeness has stages
															const aiPred = (record.ai_prediction || '').toLowerCase();
															const isFruitRipeness = ['immature', 'mature', 'overmature', 'overripe'].some(stage => aiPred.includes(stage));
															record.scan = {
																scan_type: isFruitRipeness ? 'fruit_maturity' : 'leaf_disease',
																farmer_id: '',
																expert_comment: undefined
															} as Scan;
														}
													});
												}
												
												// Fetch farmer and expert profiles from profiles table
												// Use expert_name from validation_history table if available, otherwise fetch from profiles
												const [farmerProfilesResponse, expertProfilesResponse] = await Promise.all([
													farmerIds.size > 0 ? supabase.from('profiles').select('id, full_name, username, email').in('id', Array.from(farmerIds)) : Promise.resolve({ data: [], error: null }),
													expertIds.size > 0 ? supabase.from('profiles').select('id, full_name, username, email').in('id', Array.from(expertIds)) : Promise.resolve({ data: [], error: null })
												]);
												
												// Create maps for quick lookup - prioritize full_name, fallback to username
												// Use normalized (lowercase) IDs for case-insensitive matching to ensure we find profiles even with case mismatches
												const farmerMap = new Map<string, string>();
												(farmerProfilesResponse.data || []).forEach((profile: ProfileData) => {
													if (profile && profile.id) {
														// Normalize ID to lowercase for consistent matching (UUIDs can have case variations)
														const normalizedId = String(profile.id).trim().toLowerCase();
														// Get farmer name: prioritize full_name, fallback to username
														const farmerName = (profile.full_name && profile.full_name.trim()) 
															|| (profile.username && profile.username.trim()) 
															|| 'N/A';
														// Store with normalized ID (primary key for lookups)
														farmerMap.set(normalizedId, farmerName);
														// Also store with original case as fallback
														farmerMap.set(String(profile.id).trim(), farmerName);
													}
												});
												
												const expertMap = new Map<string, string>();
												(expertProfilesResponse.data || []).forEach((profile: ProfileData) => {
													if (profile && profile.id) {
														// Normalize ID to lowercase for consistent matching
														const normalizedId = String(profile.id).trim().toLowerCase();
														const expertName = (profile.full_name && profile.full_name.trim()) 
															|| (profile.username && profile.username.trim()) 
															|| 'N/A';
														// Store with normalized ID (primary key for lookups)
														expertMap.set(normalizedId, expertName);
														// Also store with original case as fallback
														expertMap.set(String(profile.id).trim(), expertName);
													}
												});
												
												// Attach profile data to records - fetch farmer name from validation_history context
												records.forEach((record: ValidationHistoryRecord) => {
													const scan = record.scan;
													
													// Fetch farmer name from scan's farmer_id -> profiles table
													// Normalize farmer_id for case-insensitive matching to ensure we find the profile
													if (scan && scan.farmer_id) {
														const normalizedFarmerId = String(scan.farmer_id).trim().toLowerCase();
														// Try normalized ID first (most common case), then original ID as fallback
														const farmerName = farmerMap.get(normalizedFarmerId) 
															|| farmerMap.get(String(scan.farmer_id).trim())
															|| 'N/A';
														record.farmerName = farmerName;
													} else {
														record.farmerName = 'N/A';
													}
													
													// Fetch expert name - use expert_name from validation_history if available, otherwise lookup from profiles
													if (record.expert_name && record.expert_name.trim()) {
														record.expertName = record.expert_name.trim();
													} else if (record.expert_id) {
														const normalizedExpertId = String(record.expert_id).trim().toLowerCase();
														record.expertName = expertMap.get(normalizedExpertId) 
															|| expertMap.get(String(record.expert_id).trim())
															|| 'N/A';
													} else {
														record.expertName = 'N/A';
													}
													
													// Ensure scan_type is set
													if (!scan || !scan.scan_type) {
														// Try to infer from AI prediction
														const aiPred = (record.ai_prediction || '').toLowerCase();
														const isFruitRipeness = ['immature', 'mature', 'overmature', 'overripe'].some(stage => aiPred.includes(stage));
														if (!scan) {
															record.scan = {
																id: 0,
																farmer_id: '',
																scan_type: isFruitRipeness ? 'fruit_maturity' : 'leaf_disease',
																image_url: '',
																status: 'Pending Validation',
																created_at: '',
																updated_at: '',
																scan_uuid: ''
															} as Scan;
														} else {
															scan.scan_type = isFruitRipeness ? 'fruit_maturity' : 'leaf_disease';
														}
													}
												});
											}
											
											if (fetchError) {
												toast.dismiss(loadingToast);
												throw fetchError;
											}
											
											if (!records || records.length === 0) {
												toast.dismiss(loadingToast);
												toast.error('No records found for the selected period');
												return;
											}
											
											// Filter out Unknown records
											const validRecords = records.filter((record: ValidationHistoryRecord) => {
												// Exclude if scan has Unknown status
												if (record.scan && record.scan.status === 'Unknown') return false;
												// Exclude if AI prediction is Unknown
												if (record.ai_prediction === 'Unknown') return false;
												// Exclude if expert validation is Unknown
												if (record.expert_validation === 'Unknown') return false;
												// Exclude if disease_detected or ripeness_stage is Unknown
												const scan = record.scan;
												if (scan) {
													if (scan.disease_detected === 'Unknown' || scan.ripeness_stage === 'Unknown') return false;
												}
												return true;
											});
											
											// Create printable HTML content
											const printWindow = window.open("", "_blank");
											if (!printWindow) {
												toast.dismiss(loadingToast);
												toast.error("Please allow pop-ups to generate PDF");
												return;
											}
											
											const dateRangeLabel = dateRangeType === 'daily' ? 'Today' 
												: dateRangeType === 'weekly' ? 'This Week'
												: dateRangeType === 'monthly' ? 'This Month'
												: start && end ? `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`
												: 'All Time';
											
											const startDateStr = start ? start.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : 'N/A';
											const endDateStr = end ? end.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : 'N/A';
											const generatedDate = new Date().toLocaleDateString("en-US", { 
												month: "long", 
												day: "numeric", 
												year: "numeric",
												hour: "2-digit",
												minute: "2-digit"
											});
											
											// Build table rows with required fields as per requirements (Farmer Name excluded)
											const tableRows = validRecords.map((record: ValidationHistoryRecord) => {
												const scan = record.scan;
												// Determine scan type - check scan object first, then try to infer from AI prediction
												let scanType = 'N/A';
												if (scan && scan.scan_type) {
													scanType = scan.scan_type === 'leaf_disease' ? 'Leaf Disease' 
														: scan.scan_type === 'fruit_maturity' ? 'Fruit Maturity' 
														: 'N/A';
												} else if (record.ai_prediction) {
													// Try to infer from AI prediction
													const aiPred = (record.ai_prediction || '').toLowerCase();
													const isFruitRipeness = ['immature', 'mature', 'overmature', 'overripe'].some(stage => aiPred.includes(stage));
													scanType = isFruitRipeness ? 'Fruit Maturity' : 'Leaf Disease';
												}
												
												const aiPrediction = record.ai_prediction || 'N/A';
												const expertValidation = record.expert_validation || 'N/A';
												const status = record.status || 'N/A';
												const validatedAt = record.validated_at ? formatDate(record.validated_at) : 'N/A';
												const expertComment = scan?.expert_comment || record.expert_comment || 'N/A';
												const expertName = record.expertName || 'N/A';
												
												return `
													<tr>
														<td style="padding: 8px; border: 1px solid #ddd;">${scanType}</td>
														<td style="padding: 8px; border: 1px solid #ddd;">${expertName}</td>
														<td style="padding: 8px; border: 1px solid #ddd;">${aiPrediction}</td>
														<td style="padding: 8px; border: 1px solid #ddd;">${expertValidation}</td>
														<td style="padding: 8px; border: 1px solid #ddd;">${status}</td>
														<td style="padding: 8px; border: 1px solid #ddd;">${validatedAt}</td>
														<td style="padding: 8px; border: 1px solid #ddd;">${expertComment}</td>
													</tr>
												`;
											}).join('');
											
											const htmlContent = `
												<!DOCTYPE html>
												<html>
													<head>
														<title>Validation History Report - ${dateRangeLabel}</title>
														<meta charset="UTF-8">
														<style>
															* { margin: 0; padding: 0; box-sizing: border-box; }
															body { 
																font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
																padding: 40px 30px; 
																color: #1a1a1a; 
																background: #ffffff;
																line-height: 1.6;
															}
															.header {
																border-bottom: 3px solid #388E3C;
																padding-bottom: 20px;
																margin-bottom: 30px;
															}
															.header h1 {
																color: #388E3C;
																font-size: 32px;
																font-weight: 700;
																margin-bottom: 10px;
															}
															.report-info {
																margin-bottom: 30px;
																padding: 15px;
																background: #f8f9fa;
																border-radius: 6px;
															}
															.report-info p {
																margin: 5px 0;
																font-size: 14px;
																color: #555;
															}
															table { 
																width: 100%; 
																border-collapse: collapse; 
																margin: 25px 0;
																page-break-inside: avoid;
																box-shadow: 0 1px 3px rgba(0,0,0,0.1);
																font-size: 13px;
															}
															th { 
																background: linear-gradient(135deg, #388E3C 0%, #2F7A33 100%);
																color: #ffffff;
																padding: 12px 10px;
																text-align: left;
																font-weight: 600;
																font-size: 12px;
																text-transform: uppercase;
																letter-spacing: 0.5px;
															}
															td { 
																border: 1px solid #e0e0e0;
																padding: 10px;
																color: #333;
																font-size: 12px;
																word-wrap: break-word;
															}
															tr:nth-child(even) { 
																background-color: #f8f9fa;
															}
															@media print { 
																body { margin: 0; padding: 20px 15px; }
																@page { margin: 1.5cm; size: A4; }
																table { font-size: 11px; }
																th, td { padding: 8px 6px; }
															}
														</style>
													</head>
													<body>
														<div class="header">
															<h1>Validation History Report</h1>
														</div>
														<div class="report-info">
															<p><strong>Report Period:</strong> ${dateRangeLabel}</p>
															<p><strong>Date Range:</strong> ${startDateStr} to ${endDateStr}</p>
															<p><strong>Generated On:</strong> ${generatedDate}</p>
															<p><strong>Total Records:</strong> ${validRecords.length}</p>
														</div>
														<table>
															<thead>
																<tr>
																	<th>Scan Type</th>
																	<th>Expert Name</th>
																	<th>AI Prediction</th>
																	<th>Expert Validation</th>
																	<th>Status</th>
																	<th>Validated At</th>
																	<th>Expert Comment</th>
																</tr>
															</thead>
															<tbody>
																${tableRows}
															</tbody>
														</table>
														<script>
															window.onload = function() {
																setTimeout(function() {
																	window.print();
																}, 500);
															};
														</script>
													</body>
												</html>
											`;
											
											printWindow.document.write(htmlContent);
											printWindow.document.close();
											
											toast.dismiss(loadingToast);
											toast.success("PDF generated successfully. Please use your browser's print dialog to save as PDF.");
										} catch (error: unknown) {
											if (process.env.NODE_ENV === 'development') {
												console.error('Error generating PDF:', error);
											}
											toast.error('Failed to generate PDF');
										}
									}}
									className="flex items-center gap-2 text-white bg-[#388E3C] border-[#388E3C] hover:bg-[#2F7A33] hover:border-[#2F7A33] transition-colors"
								>
									<Download className="h-4 w-4" />
									Export PDF
								</Button>
							</div>
						</div>

						<Card className="shadow-lg border border-[#388E3C]/20 hover:shadow-xl transition-all duration-300 bg-white rounded-xl overflow-hidden print-table-container">
							<CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 border-b rounded-t-xl">
								<div>
									<CardTitle className="text-xl font-bold" style={{ color: 'white' }}>Validation Records</CardTitle>
									<p className="text-sm mt-1" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Expert validation history and scan details</p>
								</div>
							</CardHeader>
						<CardContent>
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
										<p className="text-gray-500 font-medium">No scans found.</p>
										<p className="text-gray-400 text-sm mt-1">Try adjusting your search criteria.</p>
									</div>
								</div>
							) : (
								<>
									<div className="overflow-x-auto print-table-wrapper">
										<Table className="w-full print-table">
											<Thead>
												<Tr>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Farmer</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Expert</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Scan Type</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">AI Prediction</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Expert Validation</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Status</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700">Validated At</Th>
													<Th className="text-left py-3 px-4 font-semibold text-sm text-gray-700 no-print">Actions</Th>
												</Tr>
											</Thead>
											<Tbody>
												{displayedRecords.map((record) => {
													// Find the original index in filtered array for edit/delete operations
													const originalIdx = filtered.findIndex(r => r.id === record.id);
													return (
												<Tr 
													key={record.id}
													className="hover:bg-gray-50 cursor-pointer transition-colors"
													onClick={() => {
														if (originalIdx >= 0) {
															setDetailIdx(originalIdx);
														}
													}}
												>
													<Td className="whitespace-nowrap py-4 px-4">
														<div className="flex items-center gap-2">
															{record.scan?.farmer_profile?.profile_picture ? (
																<Image 
																	src={record.scan.farmer_profile.profile_picture} 
																	alt="Profile" 
																	width={32}
																	height={32}
																	className="w-8 h-8 rounded-full object-cover"
																	onError={(e) => {
																		e.currentTarget.style.display = 'none';
																	}}
																/>
															) : (
																<div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600">
																	{record.scan?.farmer_profile?.full_name?.charAt(0) || record.scan?.farmer_profile?.username?.charAt(0) || '?'}
																</div>
															)}
															<div className="font-medium text-sm text-gray-900">
																{record.scan?.farmer_profile?.full_name || record.scan?.farmer_profile?.username || 'Unknown Farmer'}
															</div>
														</div>
													</Td>
													<Td className="whitespace-nowrap py-4 px-4">
														<div className="font-medium text-sm text-gray-900">
															{record.expert_profile?.full_name || record.expert_profile?.username || 'Unknown Expert'}
														</div>
													</Td>
													<Td className="py-4 px-4 text-sm text-gray-700">{record.scan ? formatScanType(record.scan.scan_type) : 'N/A'}</Td>
													<Td className="py-4 px-4 max-w-xs truncate text-sm text-gray-700">{record.ai_prediction}</Td>
													<Td className="py-4 px-4 max-w-xs truncate text-sm text-gray-700">{record.expert_validation || 'N/A'}</Td>
													<Td className="py-4 px-4">
														<Badge color={getStatusBadgeColor(record.status)}>{record.status}</Badge>
													</Td>
													<Td className="whitespace-nowrap py-4 px-4 text-sm text-gray-700">{formatDate(record.validated_at)}</Td>
													<Td className="py-4 px-4 no-print" onClick={(e) => e.stopPropagation()}>
														<div className="flex items-center gap-2 flex-nowrap">
															<Button 
																variant="outline" 
																size="sm" 
																onClick={(e) => {
																	e.stopPropagation();
																	if (originalIdx >= 0) {
																		setDetailIdx(originalIdx);
																	}
																}}
																className="text-xs text-gray-700 border-gray-300 hover:bg-gray-50 hover:text-gray-900 whitespace-nowrap"
															>
																View Details
															</Button>
															{user && record.expert_id === user.id && (
																<Button 
																	variant="outline" 
																	size="sm" 
																	onClick={(e) => {
																		e.stopPropagation();
																		if (originalIdx >= 0) {
																			setDeleteIdx(originalIdx);
																		}
																	}}
																	className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 flex-shrink-0"
																	title="Delete Validation"
																>
																	<Trash2 className="h-4 w-4" />
																</Button>
															)}
														</div>
													</Td>
												</Tr>
													);
												})}
											</Tbody>
										</Table>
									</div>
									{/* See More Button */}
									{hasMoreRecords && !showAll && (
										<div className="flex justify-center mt-4 no-print">
											<Button
												variant="outline"
												onClick={() => setShowAll(true)}
												className="text-black border-gray-300 bg-white shadow-sm"
											>
												See More ({filtered.length - 5} more records)
											</Button>
										</div>
									)}
									{showAll && hasMoreRecords && (
										<div className="flex justify-center mt-4 no-print">
											<Button
												variant="outline"
												onClick={() => {
													setShowAll(false);
													// Scroll to top of table smoothly
													window.scrollTo({ top: 0, behavior: 'smooth' });
												}}
												className="text-black border-gray-300 bg-white shadow-sm"
											>
												Show Less
											</Button>
										</div>
									)}
								</>
							)}
						</CardContent>
					</Card>

					{/* Delete Confirmation Dialog */}
					<Dialog open={deleteIdx !== null} onOpenChange={() => setDeleteIdx(null)}>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>Delete Validation Record</DialogTitle>
							</DialogHeader>
							<div className="py-4">
								<p className="text-gray-600">
									Are you sure you want to delete this validation record? This action cannot be undone.
									{deleteIdx !== null && filtered[deleteIdx]?.scan?.status && filtered[deleteIdx].scan.status !== 'Pending Validation' && (
										<span className="block mt-2 text-sm text-amber-600">
											The associated scan will be reverted to &quot;Pending Validation&quot; status.
										</span>
									)}
								</p>
							</div>
							<DialogFooter>
								<Button variant="outline" onClick={() => setDeleteIdx(null)} disabled={deleteLoading}>
									Cancel
								</Button>
								<Button 
									onClick={handleDelete} 
									disabled={deleteLoading}
									className="bg-red-600 hover:bg-red-700"
								>
									{deleteLoading ? "Deleting..." : "Delete"}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>

					{/* View Details Dialog */}
					<Dialog open={detailIdx !== null} onOpenChange={() => setDetailIdx(null)}>
						<DialogContent className="sm:max-w-4xl p-0 overflow-hidden bg-white max-h-[90vh] flex flex-col">
							{/* Header */}
							<div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 bg-gradient-to-r from-white to-gray-50 sticky top-0 z-10">
								<DialogHeader className="p-0">
									<DialogTitle className="text-xl font-bold text-gray-900">Validation Record Details</DialogTitle>
								</DialogHeader>
								<button 
									aria-label="Close" 
									onClick={() => setDetailIdx(null)} 
									className="rounded-lg p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
								>
									<X className="h-5 w-5" />
								</button>
							</div>

							{/* Scrollable Content */}
							<div className="px-6 py-6 overflow-y-auto flex-1 bg-gray-50" style={{ maxHeight: 'calc(90vh - 180px)' }}>
								{detailIdx !== null && filtered[detailIdx] && (() => {
									const record = filtered[detailIdx];
									const isFruitMaturity = record.scan?.scan_type === 'fruit_maturity';
									const expertName = record.expert_profile?.full_name || record.expert_profile?.username || 'Unknown Expert';
									
									return (
										<div className="space-y-6">
											{/* Validation Information Card */}
											<Card className="shadow-md border border-gray-200 bg-white">
												<CardHeader className="pb-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
													<CardTitle className="text-lg font-semibold text-gray-900">Validation Information</CardTitle>
												</CardHeader>
												<CardContent className="pt-6 space-y-4">
													<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
														<div className="space-y-2">
															<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Validated By</label>
															<p className="text-sm font-semibold text-gray-900">{expertName}</p>
														</div>
														<div className="space-y-2">
															<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Status</label>
															<Badge color={getStatusBadgeColor(record.status)} className="mt-1">{record.status}</Badge>
														</div>
														<div className="space-y-2">
															<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Date & Time Validated</label>
															<p className="text-sm font-medium text-gray-900">{formatDate(record.validated_at)}</p>
														</div>
														<div className="space-y-2">
															<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Scan Type</label>
															<p className="text-sm font-semibold text-gray-900">
																{record.scan ? formatScanType(record.scan.scan_type) : 'N/A'}
															</p>
														</div>
													</div>
												</CardContent>
											</Card>

											{/* Scan Information Card */}
											{record.scan && (
												<Card className="shadow-md border border-gray-200 bg-white">
													<CardHeader className="pb-4 border-b border-gray-200 bg-gradient-to-r from-emerald-50/50 to-white">
														<CardTitle className="text-lg font-semibold text-gray-900">Scan Information</CardTitle>
													</CardHeader>
													<CardContent className="pt-6 space-y-4">
														<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
															<div className="space-y-2">
																<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Date Scanned</label>
																<p className="text-sm font-medium text-gray-900">{formatDate(record.scan.created_at)}</p>
															</div>
															{record.scan.confidence !== null && record.scan.confidence !== undefined && (
																<div className="space-y-2">
																	<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">AI Confidence</label>
																	<p className="text-sm font-semibold text-blue-600">
																		{(() => {
																			const confidence = record.scan.confidence;
																			if (confidence === null || confidence === undefined) return 'N/A';
																			
																			// Convert to number if string
																			const confidenceNum = typeof confidence === 'number' 
																				? confidence 
																				: parseFloat(String(confidence));
																			
																			// Check if valid number
																			if (isNaN(confidenceNum)) return 'N/A';
																			
																			// Convert decimal (0-1) to percentage (0-100) and format to 2 decimal places
																			const confidencePercent = (confidenceNum * 100).toFixed(2);
																			
																			return `${confidencePercent}%`;
																		})()}
																	</p>
																</div>
															)}
														</div>
													</CardContent>
												</Card>
											)}

											{/* AI Prediction & Expert Validation Card */}
											<Card className="shadow-md border border-gray-200 bg-white">
												<CardHeader className="pb-4 border-b border-gray-200 bg-gradient-to-r from-purple-50/50 to-white">
													<CardTitle className="text-lg font-semibold text-gray-900">AI Prediction & Expert Validation</CardTitle>
												</CardHeader>
												<CardContent className="pt-6 space-y-5">
													{/* AI Prediction */}
													<div className="space-y-2">
														<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
															AI Prediction {isFruitMaturity ? '(Ripeness Stage)' : '(Diagnosis)'}
														</label>
														<div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
															<p className="text-sm font-semibold text-blue-900">{record.ai_prediction || 'N/A'}</p>
														</div>
													</div>

													{/* Expert Validation */}
													<div className="space-y-2">
														<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
															Expert Validation {isFruitMaturity ? '(Ripeness Stage)' : '(Diagnosis)'}
														</label>
														<div className={`rounded-lg p-4 border ${
															record.status === 'Corrected' 
																? 'bg-amber-50 border-amber-200' 
																: 'bg-green-50 border-green-200'
														}`}>
															<p className={`text-sm font-semibold ${
																record.status === 'Corrected' 
																	? 'text-amber-900' 
																	: 'text-green-900'
															}`}>
																{record.expert_validation || 'N/A'}
															</p>
															{record.status === 'Corrected' && (
																<p className="text-xs text-amber-700 mt-1">This diagnosis was corrected by the expert.</p>
															)}
														</div>
													</div>
												</CardContent>
											</Card>

											{/* Scan Image Card */}
											{(() => {
												const imageUrl = getScanImageUrlWithFallback(record.scan);
												return imageUrl ? (
													<Card className="shadow-md border border-gray-200 bg-white">
														<CardHeader className="pb-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
															<CardTitle className="text-lg font-semibold text-gray-900">Scan Image</CardTitle>
														</CardHeader>
														<CardContent className="pt-6">
															<div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
																<Image 
																	src={imageUrl} 
																	alt="Scan preview" 
																	width={800}
																	height={450}
																	className="w-full max-h-[450px] object-contain rounded-lg"
																	unoptimized={true}
																	onError={(e) => { 
																		e.currentTarget.style.display = 'none';
																		const parent = e.currentTarget.parentElement;
																		if (parent) {
																			parent.innerHTML = '<p class="text-sm text-gray-500 text-center py-8">Image failed to load</p>';
																		}
																	}}
																/>
															</div>
														</CardContent>
													</Card>
												) : null;
											})()}

											{/* Scan Details (Solution, Products) */}
											{record.scan && (record.scan.solution || record.scan.recommended_products) && (
												<Card className="shadow-md border border-gray-200 bg-white">
													<CardHeader className="pb-4 border-b border-gray-200 bg-gradient-to-r from-emerald-50/50 to-white">
														<CardTitle className="text-lg font-semibold text-gray-900">
															{isFruitMaturity ? 'Harvest Recommendations' : 'Treatment & Solutions'}
														</CardTitle>
													</CardHeader>
													<CardContent className="pt-6 space-y-4">
														{record.scan.solution && (
															<div className="space-y-2">
																<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
																	{isFruitMaturity ? 'Harvest Recommendation' : 'Treatment / Solution'}
																</label>
																<div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
																	<p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{record.scan.solution}</p>
																</div>
															</div>
														)}
														{record.scan.recommended_products && (
															<div className="space-y-2">
																<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Recommended Products</label>
																<div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
																	<p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{record.scan.recommended_products}</p>
																</div>
															</div>
														)}
													</CardContent>
												</Card>
											)}

											{/* Expert Comment Card */}
											<Card className="shadow-md border border-gray-200 bg-white">
												<CardHeader className="pb-4 border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white">
													<CardTitle className="text-lg font-semibold text-gray-900">Expert Comment</CardTitle>
												</CardHeader>
												<CardContent className="pt-6">
													{record.expert_comment ? (
														<div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
															<p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{record.expert_comment}</p>
														</div>
													) : (
														<div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
															<p className="text-sm text-gray-400 italic">No comment provided by the expert.</p>
														</div>
													)}
												</CardContent>
											</Card>
										</div>
									);
								})()}
							</div>

							{/* Footer */}
							<div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end sticky bottom-0">
								<Button 
									variant="outline" 
									onClick={() => setDetailIdx(null)}
									className="text-gray-700 border-gray-300 hover:bg-gray-100"
								>
									Close
								</Button>
							</div>
						</DialogContent>
					</Dialog>
				</div>
			</AppShell>
		</AuthGuard>
	);
}




