"use client";

import { useMemo, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { motion } from "framer-motion";
import { UsersRound, Camera, CheckCircle2, AlertCircle } from "lucide-react";
import { Table, Thead, Tbody, Tr, Th, Td } from "./ui/table";
import { useUser } from "./UserContext";
import { useData } from "./DataContext";
import { getAiPrediction, type Scan } from "../types";
import Image from "next/image";

// Format timestamp from database (UTC) to readable format with correct AM/PM
const formatDate = (dateString: string): string => {
	try {
		const date = new Date(dateString);
		if (isNaN(date.getTime())) return 'Invalid Date';
		
		// Use UTC methods to display exact database timestamp
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const month = monthNames[date.getUTCMonth()];
		const day = date.getUTCDate();
		const year = date.getUTCFullYear();
		
		let hours = date.getUTCHours();
		const minutes = date.getUTCMinutes();
		// Determine AM/PM BEFORE converting to 12-hour format
		const ampm = hours >= 12 ? 'PM' : 'AM';
		// Convert to 12-hour format
		hours = hours % 12;
		hours = hours || 12; // Convert 0 to 12
		const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
		
		return `${month} ${day}, ${year} - ${hours}:${minutesStr} ${ampm}`;
	} catch {
		return 'Invalid Date';
	}
};


// Memoized helper functions outside component
const formatScanType = (type: string) => {
	return type === 'leaf_disease' ? 'Leaf Disease' : 'Fruit Maturity';
};

const getStatusColor = (status: string) => {
	switch (status) {
		case 'Pending Validation':
			return 'bg-amber-100 text-amber-700';
		case 'Validated':
			return 'bg-green-100 text-green-700';
		case 'Corrected':
			return 'bg-blue-100 text-blue-700';
		default:
			return 'bg-gray-100 text-gray-700';
	}
};

// Memoized loading skeleton component
const LoadingSkeleton = memo(() => (
	<div className="min-h-[60vh] flex items-center justify-center">
		<div className="text-center">
			<div className="h-10 w-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
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
	index 
}: { 
	icon: React.ComponentType<{ className?: string }>;
	label: string;
	value: number;
	color: string;
	index: number;
}) => (
	<motion.div 
		initial={{ y: 12, opacity: 0 }} 
		animate={{ y: 0, opacity: 1 }} 
		transition={{ delay: index * 0.05, duration: 0.3 }}
	>
		<Card>
			<CardHeader className="pb-2">
				<CardTitle>{label}</CardTitle>
			</CardHeader>
			<CardContent className="flex items-center justify-between">
				<p className="text-3xl font-semibold">{value.toLocaleString("en-US")}</p>
				<Icon className={`h-8 w-8 ${color}`} />
			</CardContent>
		</Card>
	</motion.div>
));
StatCard.displayName = "StatCard";

function DashboardContent() {
	const { user, profile } = useUser();
	const { scans, totalUsers, loading, error } = useData();

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

	const { totalScans, validatedScans, pendingValidations, recentScans } = useMemo(() => {
		// Early return if no valid scans
		if (!validScans || validScans.length === 0) {
			return { 
				totalScans: 0, 
				validatedScans: 0, 
				pendingValidations: 0, 
				recentScans: [] 
			};
		}
		
		// Get latest values from database (excluding Unknown scans)
		const total = validScans.length; // Total Scans
		
		// Count pending scans (status === 'Pending Validation')
		const pending = validScans.filter(scan => scan.status === 'Pending Validation').length;
		
		// Calculate Validated: Count scans where status !== "Pending Validation"
		// This includes scans with status "Validated", "Corrected", or any other non-pending status
		const validated = validScans.filter(scan => {
			return scan.status && scan.status !== 'Pending Validation';
		}).length;
		
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
			recentScans: recent 
		};
	}, [validScans]);


	if (loading) {
		return <LoadingSkeleton />;
	}

	if (error) {
		return <ErrorDisplay error={error} />;
	}

	// Ensure scans is defined before rendering
	if (!scans) {
		return <LoadingSkeleton />;
	}

	return (
		<div className="space-y-6 max-w-7xl mx-auto">
			{/* Welcome Section */}
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-2xl font-semibold text-gray-900">Welcome back, {displayName}!</h2>
					<p className="mt-1 text-sm text-gray-600">Here&apos;s what&apos;s happening with your {userRole.toLowerCase()} dashboard today.</p>
				</div>
			</div>

			<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 md:gap-6">
				{[
					{ icon: UsersRound, label: "Total Users", value: totalUsers, color: "text-green-600" },
					{ icon: Camera, label: "Total Scans", value: totalScans, color: "text-green-600" },
					{ icon: CheckCircle2, label: "Validated", value: validatedScans, color: "text-green-600" },
					{ icon: AlertCircle, label: "Pending", value: pendingValidations, color: "text-amber-600" }
				].map((s, idx) => (
					<StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} color={s.color} index={idx} />
				))}
			</div>

			{/* Recent Scans Section */}
			<Card>
				<CardHeader className="pb-0">
					<CardTitle>Recent Scans</CardTitle>
				</CardHeader>
				<CardContent>
					{recentScans.length === 0 ? (
						<div className="flex items-center justify-center py-8">
							<div className="text-center">
								<AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
								<p className="text-gray-500 font-medium">No scans available yet.</p>
							</div>
						</div>
					) : (
						<div className="overflow-x-auto">
							<Table className="rounded-lg border border-gray-200 shadow-sm">
								<Thead>
									<Tr>
										<Th className="whitespace-nowrap">Farmer Name</Th>
										<Th className="whitespace-nowrap">Scan Type</Th>
										<Th className="whitespace-nowrap">AI Prediction</Th>
										<Th className="whitespace-nowrap">Status</Th>
										<Th className="whitespace-nowrap">Date & Time</Th>
									</Tr>
								</Thead>
								<Tbody>
									{recentScans.map((scan) => {
										// Use scan_uuid as key if available, otherwise combine scan_type and id for uniqueness
										const uniqueKey = scan.scan_uuid || `${scan.scan_type}-${scan.id}`;
										
										return (
											<Tr key={uniqueKey}>
												<Td className="whitespace-nowrap">
													<div className="flex items-center gap-2">
														{scan.farmer_profile?.profile_picture ? (
															<Image 
																src={scan.farmer_profile.profile_picture} 
																alt="Profile" 
																width={32}
																height={32}
																className="w-8 h-8 rounded-full object-cover"
																loading="lazy"
																priority={false}
																onError={(e) => {
																	e.currentTarget.style.display = 'none';
																}}
															/>
														) : (
															<div className="w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium">
																{scan.farmer_profile?.full_name?.charAt(0) || scan.farmer_profile?.username?.charAt(0) || '?'}
															</div>
														)}
														<div className="font-medium text-sm">
															{scan.farmer_profile?.full_name || scan.farmer_profile?.username || 'Unknown Farmer'}
														</div>
													</div>
												</Td>
												<Td>{scan.scan_type ? formatScanType(scan.scan_type) : 'N/A'}</Td>
												<Td className="max-w-xs truncate">{scan.ai_prediction || 'N/A'}</Td>
												<Td>
													<span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${getStatusColor(scan.status)}`}>
														{scan.status}
													</span>
												</Td>
												<Td className="whitespace-nowrap text-gray-500">
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


