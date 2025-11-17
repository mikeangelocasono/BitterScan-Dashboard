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
import { Loader2, AlertCircle, Trash2, X } from "lucide-react";
import { useUser } from "@/components/UserContext";
import { useData } from "@/components/DataContext";

// Accurate date formatter - shows local time without timezone shifts
const formatHistoryDate = (dateString: string): string => {
	try {
		const date = new Date(dateString);
		if (isNaN(date.getTime())) return 'Invalid Date';
		
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const month = monthNames[date.getMonth()];
		const day = date.getDate();
		const year = date.getFullYear();
		
		let hours = date.getHours();
		const minutes = date.getMinutes();
		const ampm = hours >= 12 ? 'PM' : 'AM';
		hours = hours % 12;
		hours = hours ? hours : 12; // 0 should be 12
		const minutesStr = minutes < 10 ? `0${minutes}` : minutes;
		
		return `${month} ${day}, ${year} - ${hours}:${minutesStr} ${ampm}`;
	} catch {
		return 'Invalid Date';
	}
};

export default function HistoryPage() {
	const [dateRangeType, setDateRangeType] = useState<'daily' | 'weekly' | 'monthly' | 'custom' | 'none'>('none');
	const [startDate, setStartDate] = useState<string>("");
	const [endDate, setEndDate] = useState<string>("");
	const [showAll, setShowAll] = useState(false);
	const [detailIdx, setDetailIdx] = useState<number | null>(null);
	const [deleteIdx, setDeleteIdx] = useState<number | null>(null);
	const [deleteLoading, setDeleteLoading] = useState(false);
	const { user } = useUser();
	const { scans, validationHistory, loading, error, refreshData } = useData();

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

	// Filter validation history based on date range
	const filtered = useMemo(() => {
		if (dateRangeType === 'none') {
			return validationHistory;
		}
		
		const { start, end } = getDateRange(dateRangeType);
		if (!start || !end) {
			return validationHistory;
		}
		
		return validationHistory.filter(record => {
			const recordDate = new Date(record.validated_at);
			return recordDate >= start && recordDate <= end;
		});
	}, [validationHistory, dateRangeType, getDateRange]);

	// Memoized helper functions to prevent recreation on every render
	const formatScanType = useCallback((type: string) => {
		return type === 'leaf_disease' ? 'Leaf Disease' : 'Fruit Maturity';
	}, []);

	// Memoized date formatter - uses accurate local time
	const formatDate = useCallback((dateString: string) => {
		return formatHistoryDate(dateString);
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

	const getStatusColor = useCallback((status: string) => {
		switch (status) {
			case 'Pending Validation':
				return 'amber';
			case 'Validated':
				return 'green';
			case 'Corrected':
				return 'blue';
			default:
				return 'gray';
		}
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
			const { error: deleteError } = await supabase
				.from('validation_history')
				.delete()
				.eq('id', record.id);

			if (deleteError) throw deleteError;

			// Optionally revert scan status to pending if it was validated
			if (record.scan_id && (record.status === 'Validated' || record.status === 'Corrected')) {
				await supabase
					.from('scans')
					.update({
						status: 'Pending Validation',
						expert_comment: null,
						updated_at: new Date().toISOString()
					})
					.eq('id', record.scan_id);
			}

			toast.success("Validation record deleted successfully");
			setDeleteIdx(null);
			await refreshData();
		} catch (err: unknown) {
			console.error('Error deleting validation:', err);
			toast.error('Failed to delete validation record');
		} finally {
			setDeleteLoading(false);
		}
	}, [deleteIdx, filtered, user, refreshData]);

	// Calculate statistics from real data
	// Total Scans: Total number of scans in the database
	const totalRecords = scans.length;
	
	// Total Validated: Count of all validated scans (including both "Validated" and "Corrected" status)
	const totalValidated = useMemo(() => {
		return scans.filter(scan => scan.status === 'Validated' || scan.status === 'Corrected').length;
	}, [scans]);
	
	// Validation Rate: Percentage of scans that have been validated
	// Formula: (Total Validated Scans / Total Scans) × 100
	// Total Validated Scans includes both confirmed and corrected scans
	const validationRate = useMemo(() => {
		if (totalRecords === 0) return '0.0';
		const rate = (totalValidated / totalRecords) * 100;
		return rate.toFixed(1);
	}, [totalValidated, totalRecords]);
	
	// Expert Corrections: Number of scans that were corrected by experts
	const correctedRecords = scans.filter(scan => scan.status === 'Corrected').length;

	return (
		<AuthGuard>
			<AppShell>
				<div className="space-y-6">
					<div className="no-print">
						<h2 className="text-2xl font-semibold text-gray-900">History</h2>
					</div>
					<div className="print-only" style={{ display: 'none' }}>
						<h1 className="text-2xl font-bold mb-2">Validation History Report</h1>
						<p className="text-sm text-gray-600 mb-4">
							Generated on {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
							{dateRangeType !== 'none' && (
								<span>
									{dateRangeType === 'custom' && startDate && endDate
										? ` • Filtered: ${startDate} to ${endDate}`
										: ` • Filtered: ${dateRangeType.charAt(0).toUpperCase() + dateRangeType.slice(1)}`
									}
								</span>
							)}
						</p>
					</div>

					{/* Stats */}
					<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
						<Card className="shadow-sm hover:shadow-md transition-shadow">
							<CardHeader className="pb-2">
								<CardTitle>Total Scans</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-3xl font-semibold">{totalRecords.toLocaleString("en-US")}</p>
							</CardContent>
						</Card>
						<Card className="shadow-sm hover:shadow-md transition-shadow">
							<CardHeader className="pb-2">
								<CardTitle>Total Validated</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-3xl font-semibold">{totalValidated.toLocaleString("en-US")}</p>
							</CardContent>
						</Card>
						<Card className="shadow-sm hover:shadow-md transition-shadow">
							<CardHeader className="pb-2">
								<CardTitle>Validation Rate</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-3xl font-semibold">{validationRate}%</p>
							</CardContent>
						</Card>
						<Card className="shadow-sm hover:shadow-md transition-shadow">
							<CardHeader className="pb-2">
								<CardTitle>Expert Corrections</CardTitle>
							</CardHeader>
							<CardContent>
								<p className="text-3xl font-semibold">{correctedRecords.toLocaleString("en-US")}</p>
							</CardContent>
						</Card>
					</div>

					{/* Date Range Filter */}
					<div className="flex flex-wrap items-center gap-3 no-print">
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

					<Card className="shadow-sm print-table-container">
						<CardHeader className="pb-4 flex items-center justify-between border-b">
							<CardTitle className="text-lg font-semibold text-gray-900">Validation Records</CardTitle>
							<div className="flex gap-2 no-print">
								<Button 
									variant="outline" 
									size="sm"
									onClick={() => {
										try {
											// CSV Headers matching table columns
											const headers = [
												'Farmer Name',
												'Farmer Email',
												'Expert Name',
												'Scan Type',
												'AI Prediction',
												'Expert Validation',
												'Status',
												'Validated At'
											];

											// Build CSV rows with proper escaping (use all filtered records, not just displayed)
											const rows = filtered.map(record => {
												const farmerName = record.scan?.farmer_profile?.full_name || record.scan?.farmer_profile?.username || 'Unknown';
												const farmerEmail = record.scan?.farmer_profile?.email || record.scan?.farmer_id || 'N/A';
												const expertName = record.expert_profile?.full_name || record.expert_profile?.username || 'Unknown Expert';
												const scanType = record.scan ? formatScanType(record.scan.scan_type) : 'N/A';
												const aiPrediction = record.ai_prediction || 'N/A';
												const expertValidation = record.expert_validation || 'N/A';
												const status = record.status || 'N/A';
												const validatedAt = formatDate(record.validated_at);

												return [
													escapeCSV(farmerName),
													escapeCSV(farmerEmail),
													escapeCSV(expertName),
													escapeCSV(scanType),
													escapeCSV(aiPrediction),
													escapeCSV(expertValidation),
													escapeCSV(status),
													escapeCSV(validatedAt)
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
											toast.success(`CSV exported (${filtered.length} records)`);
										} catch (error: unknown) {
											console.error('Error exporting CSV:', error);
											toast.error('Failed to export CSV');
										}
									}}
								>
									Export CSV
								</Button>
								<Button 
									size="sm"
									onClick={() => {
										// Add print-specific class to body
										document.body.classList.add('printing');
										window.print();
										// Remove class after print dialog closes
										setTimeout(() => {
											document.body.classList.remove('printing');
										}, 1000);
									}}
								>
									Export PDF
								</Button>
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
												{displayedRecords.map((record, idx) => {
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
																<img 
																	src={record.scan.farmer_profile.profile_picture} 
																	alt="Profile" 
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
														<Badge color={getStatusColor(record.status)}>{record.status}</Badge>
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
									{deleteIdx !== null && filtered[deleteIdx]?.scan_id && (
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
						<DialogContent className="sm:max-w-3xl p-0 overflow-hidden bg-white max-h-[90vh] flex flex-col">
							{/* Header */}
							<div className="flex items-center justify-between px-6 py-5 border-b border-gray-200 bg-white sticky top-0 z-10">
								<DialogHeader className="p-0">
									<DialogTitle className="text-xl font-semibold text-gray-900">Validation Details</DialogTitle>
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
							<div className="px-6 py-6 overflow-y-auto flex-1">
								{detailIdx !== null && filtered[detailIdx] && (() => {
									const record = filtered[detailIdx];
									const isFruitMaturity = record.scan?.scan_type === 'fruit_maturity';
									return (
										<div className="space-y-6">
											{/* Scan Type & Status Section */}
											<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
												<div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
													<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Scan Type</label>
													<p className="text-sm font-semibold text-gray-900">
														{record.scan ? formatScanType(record.scan.scan_type) : 'N/A'}
													</p>
												</div>
												<div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
													<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Status</label>
													<Badge color={getStatusColor(record.status)} className="mt-1">{record.status}</Badge>
												</div>
											</div>

											{/* Scan Result Details */}
											{record.scan && (
												<div className="space-y-5 bg-white rounded-lg border border-gray-200 p-5">
													<h2 className="text-base font-semibold text-gray-900 border-b border-gray-200 pb-2">Scan Results</h2>
													
													{/* Disease / Fruit Ripeness */}
													<div className="space-y-2">
														<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
															{isFruitMaturity ? 'Fruit Ripeness' : 'Disease / Diagnosis'}
														</label>
														<p className="text-sm font-medium text-gray-900 leading-relaxed">{record.ai_prediction || 'N/A'}</p>
													</div>

													{/* Confidence Level */}
													{record.scan.confidence !== null && record.scan.confidence !== undefined && (
														<div className="space-y-2">
															<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Confidence Level</label>
															<p className="text-sm font-medium text-gray-900">
																{typeof record.scan.confidence === 'number' 
																	? `${record.scan.confidence.toFixed(1)}%` 
																	: `${parseFloat(String(record.scan.confidence)).toFixed(1)}%`}
															</p>
														</div>
													)}

													{/* Treatment / Solution / Harvest Recommendation */}
													{record.scan.solution && (
														<div className="space-y-2">
															<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">
																{isFruitMaturity ? 'Harvest Recommendation' : 'Treatment / Solution'}
															</label>
															<p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{record.scan.solution}</p>
														</div>
													)}

													{/* Recommended Products */}
													{record.scan.recommended_products && (
														<div className="space-y-2">
															<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Recommended Products</label>
															<p className="text-sm text-gray-700 leading-relaxed">{record.scan.recommended_products}</p>
														</div>
													)}
												</div>
											)}

											{/* Scan Image */}
											{record.scan?.image_url && (
												<div className="space-y-3 bg-white rounded-lg border border-gray-200 p-5">
													<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Scan Image</label>
													<div className="mt-2 bg-gray-50 rounded-lg p-3 border border-gray-200">
														<img 
															src={record.scan.image_url} 
															alt="Scan preview" 
															className="w-full max-h-[400px] object-contain rounded-lg"
															onError={(e) => { 
																e.currentTarget.style.display = 'none';
																const parent = e.currentTarget.parentElement;
																if (parent) {
																	parent.innerHTML = '<p class="text-sm text-gray-500 text-center py-8">Image failed to load</p>';
																}
															}}
														/>
													</div>
												</div>
											)}

											{/* Expert Comment */}
											<div className="space-y-3 bg-white rounded-lg border border-gray-200 p-5">
												<label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Expert Comment</label>
												{record.expert_validation ? (
													<p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-4 border border-gray-200">
														{record.expert_validation}
													</p>
												) : (
													<p className="text-sm text-gray-400 italic bg-gray-50 rounded-lg p-4 border border-gray-200">
														No comment provided by the expert.
													</p>
												)}
											</div>
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




