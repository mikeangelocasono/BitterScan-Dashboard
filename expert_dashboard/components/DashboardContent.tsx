"use client";

import { useMemo, memo, useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { motion } from "framer-motion";
import { UsersRound, Camera, CheckCircle2, AlertCircle } from "lucide-react";
import { Table, Thead, Tbody, Tr, Th, Td } from "./ui/table";
import { useUser } from "./UserContext";
import { useData } from "./DataContext";
import { getAiPrediction, type Scan } from "../types";
import Image from "next/image";
import { formatDate, formatScanType, getStatusColor } from "../utils/dateUtils";

// Memoized loading skeleton component
const LoadingSkeleton = memo(() => (
	<div className="min-h-[60vh] flex items-center justify-center">
		<div className="text-center">
			<div className="h-10 w-10 border-4 border-[#388E3C] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
			<p className="text-gray-600 text-sm">Loading dashboard...</p>
		</div>
	</div>
));
LoadingSkeleton.displayName = "LoadingSkeleton";

// Memoized error component
const ErrorDisplay = memo(({ error }: { error: string }) => (
	<div className="min-h-[60vh] flex items-center justify-center">
		<div className="text-center space-y-4">
			<p className="text-red-600 font-medium">{error}</p>
		</div>
	</div>
));
ErrorDisplay.displayName = "ErrorDisplay";

// Memoized stat card component
const StatCard = memo(({ 
	icon: Icon, 
	label, 
	value, 
	color, 
	bgColor,
	index 
}: { 
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: number;
	color: string;
	bgColor: string;
	index: number;
}) => (
	<motion.div 
		initial={{ y: 12, opacity: 0 }} 
		animate={{ y: 0, opacity: 1 }} 
		transition={{ delay: index * 0.05, duration: 0.3 }}
	>
		<Card className="shadow-sm hover:shadow-md transition-all duration-200 h-full">
			<CardHeader className="pb-2 pt-4">
				<CardTitle className="flex items-center justify-between">
					<span className="text-sm font-semibold text-gray-700">{label}</span>
					<div className={`p-1.5 rounded-lg ${bgColor}`}>
						<Icon className={`h-4 w-4 ${color}`} />
					</div>
				</CardTitle>
			</CardHeader>
			<CardContent className="pb-4 pt-2">
				<p className="text-2xl font-bold text-gray-900">{value.toLocaleString("en-US")}</p>
			</CardContent>
		</Card>
	</motion.div>
));
StatCard.displayName = "StatCard";

function DashboardContent() {
	const { user, profile, loading: userLoading, sessionReady } = useUser();
	const { scans, totalUsers, loading: dataLoading, error } = useData();
	const [forceRender, setForceRender] = useState(false);

	// Master timeout: force render after 1 second to prevent infinite loading
	useEffect(() => {
		const timeout = setTimeout(() => {
			if (!forceRender) {
				console.warn('[DashboardContent] Forcing render after timeout');
				setForceRender(true);
			}
		}, 1000);
		return () => clearTimeout(timeout);
	}, [forceRender]);

	// Show loading state only during initial session resolution
	// Once sessionReady=true OR we have scans data OR forceRender, render dashboard
	// This prevents infinite loading spinner on page refresh
	const hasData = scans && scans.length >= 0; // scans array exists (even if empty)
	const isLoading = !forceRender && !sessionReady && (userLoading || (dataLoading && !hasData));

	// Memoize computed values
	const displayName = useMemo(() => {
		return profile?.full_name || user?.user_metadata?.full_name || "Expert";
	}, [profile?.full_name, user?.user_metadata?.full_name]);

	const userRole = useMemo(() => {
		return profile?.role || user?.user_metadata?.role || "Expert";
	}, [profile?.role, user?.user_metadata?.role]);

	// Filter out Unknown scans from all metrics and display
	const validScans = useMemo(() => {
		if (!scans || scans.length === 0) return [];
		
		return scans.filter(scan => {
			if (scan.status === 'Unknown') return false;
			const result = getAiPrediction(scan);
			if (result === 'Unknown') return false;
			return true;
		});
	}, [scans]);

	const { totalScans, validatedScans, pendingValidations, correctedScans, recentScans } = useMemo(() => {
		// Early return if no valid scans
		if (!validScans || validScans.length === 0) {
			return { 
				totalScans: 0, 
				validatedScans: 0, 
				pendingValidations: 0, 
				correctedScans: 0,
				recentScans: [] 
			};
		}
		
		// Get latest values from database (excluding Unknown scans)
		const total = validScans.length; // Total Scans
		
		// Count by explicit status buckets
		const pending = validScans.filter(scan => scan.status === 'Pending' || scan.status === 'Pending Validation').length;
		const validated = validScans.filter(scan => scan.status === 'Validated').length;
		const corrected = validScans.filter(scan => scan.status === 'Corrected').length;
		
		// Get recent scans sorted by date (most recent first), limit to 5
		// All Unknown scans are already filtered out above
		const recent = [...validScans]
			.sort((a, b) => {
				// Sort by created_at descending (newest first)
				const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
				const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
				return dateB - dateA;
			})
			.slice(0, 5);
		
		return { 
			totalScans: total, 
			validatedScans: validated, 
			pendingValidations: pending, 
			correctedScans: corrected,
			recentScans: recent 
		};
	}, [validScans]);


	// Show loading only briefly during initial session resolution
	// If sessionReady is true, always show content (even with empty data)
	if (isLoading) {
		return <LoadingSkeleton />;
	}

	if (error) {
		return <ErrorDisplay error={error} />;
	}

	return (
		<div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
			{/* Welcome Section */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-1">Welcome back, {displayName}!</h1>
					<p className="text-gray-600 text-sm">Here&apos;s what&apos;s happening with your {userRole.toLowerCase()} dashboard today.</p>
				</div>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
				{[
					{ icon: Camera, label: "Total Scans", value: totalScans, color: "text-blue-600", bgColor: "bg-blue-50" },
					{ icon: AlertCircle, label: "Pending Validation", value: pendingValidations, color: "text-amber-600", bgColor: "bg-amber-50" },
					{ icon: CheckCircle2, label: "Validated", value: validatedScans, color: "text-emerald-600", bgColor: "bg-emerald-50" },
					{ icon: AlertCircle, label: "Corrected", value: correctedScans, color: "text-purple-600", bgColor: "bg-purple-50" }
				].map((s, idx) => (
					<StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} color={s.color} bgColor={s.bgColor} index={idx} />
				))}
			</div>

			{/* Recent Scans Section */}
			<Card className="shadow-sm border border-gray-200 hover:shadow-md transition-all duration-200 bg-white rounded-lg overflow-hidden">
				<CardHeader className="pb-3 bg-gradient-to-r from-[#388E3C] to-[#2F7A33] text-white px-6 pt-5 border-b rounded-t-xl">
					<CardTitle className="text-lg font-bold" style={{ color: 'white' }}>Recent Scans</CardTitle>
					<p className="text-sm mt-1" style={{ color: 'rgba(255, 255, 255, 0.9)' }}>Latest scan submissions and their validation status</p>
				</CardHeader>
				<CardContent className="p-0">
					{recentScans.length === 0 ? (
						<div className="flex items-center justify-center py-16">
							<div className="text-center">
								<AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
								<p className="text-gray-500 font-medium text-sm">No scans available yet</p>
								<p className="text-gray-400 text-xs mt-1">Recent scans will appear here</p>
							</div>
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table className="w-full">
								<Thead>
									<Tr className="bg-gray-50 border-b-2 border-gray-200">
										<Th className="whitespace-nowrap text-xs font-semibold text-gray-700 uppercase tracking-wider">Farmer</Th>
										<Th className="whitespace-nowrap text-xs font-semibold text-gray-700 uppercase tracking-wider">Scan Type</Th>
										<Th className="whitespace-nowrap text-xs font-semibold text-gray-700 uppercase tracking-wider">AI Prediction</Th>
										<Th className="whitespace-nowrap text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</Th>
										<Th className="whitespace-nowrap text-xs font-semibold text-gray-700 uppercase tracking-wider">Date & Time</Th>
									</Tr>
								</Thead>
								<Tbody>
									{recentScans.map((scan) => {
										// Use scan_uuid as key if available, otherwise combine scan_type and id for uniqueness
										const uniqueKey = scan.scan_uuid || `${scan.scan_type}-${scan.id}`;
										
										return (
											<Tr key={uniqueKey} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
												<Td className="whitespace-nowrap py-4 px-6">
													<div className="flex items-center gap-3">
														{scan.farmer_profile?.profile_picture ? (
															<Image 
																src={scan.farmer_profile.profile_picture} 
																alt="Profile" 
																width={36}
																height={36}
																className="w-9 h-9 rounded-full object-cover ring-2 ring-gray-100"
																loading="lazy"
																onError={(e) => {
																	e.currentTarget.style.display = 'none';
																}}
															/>
														) : (
															<div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-sm font-semibold text-white ring-2 ring-gray-100">
																{scan.farmer_profile?.full_name?.charAt(0) || scan.farmer_profile?.username?.charAt(0) || '?'}
															</div>
														)}
														<div className="font-medium text-sm text-gray-900">
															{scan.farmer_profile?.full_name || scan.farmer_profile?.username || 'Unknown Farmer'}
														</div>
													</div>
												</Td>
												<Td className="py-4 px-6 text-sm text-gray-700 font-medium">{scan.scan_type ? formatScanType(scan.scan_type) : 'N/A'}</Td>
												<Td className="py-4 px-6 max-w-xs truncate text-sm text-gray-700">{getAiPrediction(scan) || 'N/A'}</Td>
												<Td className="py-4 px-6">
													<span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${getStatusColor(scan.status)}`}>
														{scan.status}
													</span>
												</Td>
												<Td className="py-4 px-6 whitespace-nowrap text-sm text-gray-500">
													{scan.created_at ? formatDate(scan.created_at) : 'N/A'}
												</Td>
											</Tr>
										);
									})}
								</Tbody>
							</Table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

export default memo(DashboardContent);


