"use client";

import { useMemo, memo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { motion } from "framer-motion";
import { UsersRound, Camera, CheckCircle2, AlertCircle } from "lucide-react";
import { Table, Thead, Tbody, Tr, Th, Td } from "./ui/table";
import { useUser } from "./UserContext";
import { useData } from "./DataContext";
import Image from "next/image";

const DASHBOARD_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	timeZone: "UTC",
});

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

	const { totalScans, validatedScans, pendingValidations, recentScans } = useMemo(() => {
		// Get latest values from database
		const total = scans.length; // Total Scans
		const pending = scans.filter(scan => scan.status === 'Pending Validation').length; // Pending
		
		// Calculate Validated: Total Scans - Pending
		const validated = total - pending;
		
		const recent = scans.slice(0, 5);
		return { totalScans: total, validatedScans: validated, pendingValidations: pending, recentScans: recent };
	}, [scans]);

	const formatDate = useMemo(() => {
		return (dateString: string) => DASHBOARD_DATE_FORMATTER.format(new Date(dateString));
	}, []);

	if (loading) {
		return <LoadingSkeleton />;
	}

	if (error) {
		return <ErrorDisplay error={error} />;
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
					{ icon: UsersRound, label: "Total Users", value: totalUsers, color: "text-emerald-600" },
					{ icon: Camera, label: "Total Scans", value: totalScans, color: "text-emerald-600" },
					{ icon: CheckCircle2, label: "Validated", value: validatedScans, color: "text-emerald-600" },
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
										<Th className="whitespace-nowrap">Timestamp</Th>
									</Tr>
								</Thead>
								<Tbody>
									{recentScans.map((scan) => (
										<Tr key={scan.id}>
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
											<Td>{formatScanType(scan.scan_type)}</Td>
											<Td className="max-w-xs truncate">{scan.ai_prediction}</Td>
											<Td>
												<span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${getStatusColor(scan.status)}`}>
													{scan.status}
												</span>
											</Td>
											<Td className="whitespace-nowrap text-gray-500">
												{formatDate(scan.created_at)}
											</Td>
										</Tr>
									))}
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


