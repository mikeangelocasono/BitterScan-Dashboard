/**
 * Shared date formatting utilities
 * Provides consistent date formatting across the application
 */

/**
 * Format timestamp from database (UTC) to readable format with correct AM/PM
 * Used across dashboard, validate, and history pages
 */
export function formatDate(dateString: string): string {
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
}

/**
 * Format scan type for display
 */
export function formatScanType(type: string): string {
	return type === 'leaf_disease' ? 'Leaf Disease' : 'Fruit Maturity';
}

/**
 * Get status color class for badges
 */
export function getStatusColor(status: string): string {
	switch (status) {
		case 'Pending Validation':
			return 'bg-amber-100 text-amber-700';
		case 'Validated':
			return 'text-[#388E3C]' + ' ' + 'bg-[#E6F3E7]';
		case 'Corrected':
			return 'bg-blue-100 text-blue-700';
		default:
			return 'bg-gray-100 text-gray-700';
	}
}

/**
 * Get status color for Badge component
 */
export function getStatusBadgeColor(status: string): 'amber' | 'green' | 'blue' | 'gray' {
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
}

/**
 * Get date range based on type
 * Used in validate and history pages
 */
export function getDateRange(
	type: 'daily' | 'weekly' | 'monthly' | 'custom' | 'none',
	startDate?: string,
	endDate?: string
): { start: Date | null; end: Date | null } {
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
}

