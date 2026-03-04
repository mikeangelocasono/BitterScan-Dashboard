"use client";

import { useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { clsx } from "clsx";

export interface PaginationProps {
	/** Current page number (1-indexed) */
	currentPage: number;
	/** Total number of records */
	totalRecords: number;
	/** Number of records per page (default: 5) */
	pageSize?: number;
	/** Callback when page changes */
	onPageChange: (page: number) => void;
	/** Show "Showing X-Y of Z" indicator */
	showInfo?: boolean;
	/** Additional CSS classes */
	className?: string;
}

/**
 * Professional pagination component with jTable-style controls.
 * Displays page numbers, prev/next buttons, and record count indicator.
 */
export default function Pagination({
	currentPage,
	totalRecords,
	pageSize = 5,
	onPageChange,
	showInfo = true,
	className,
}: PaginationProps) {
	// Calculate total pages
	const totalPages = useMemo(() => {
		return Math.max(1, Math.ceil(totalRecords / pageSize));
	}, [totalRecords, pageSize]);

	// Calculate visible page range and indicators
	const { startRecord, endRecord, pageNumbers } = useMemo(() => {
		const start = totalRecords === 0 ? 0 : (currentPage - 1) * pageSize + 1;
		const end = Math.min(currentPage * pageSize, totalRecords);

		// Generate page numbers to display (max 5 visible at a time)
		const pages: (number | "...")[] = [];
		const maxVisiblePages = 5;

		if (totalPages <= maxVisiblePages) {
			// Show all pages if total is small
			for (let i = 1; i <= totalPages; i++) {
				pages.push(i);
			}
		} else {
			// Show first page
			pages.push(1);

			if (currentPage > 3) {
				pages.push("...");
			}

			// Show pages around current
			const startPage = Math.max(2, currentPage - 1);
			const endPage = Math.min(totalPages - 1, currentPage + 1);

			for (let i = startPage; i <= endPage; i++) {
				if (!pages.includes(i)) {
					pages.push(i);
				}
			}

			if (currentPage < totalPages - 2) {
				pages.push("...");
			}

			// Show last page
			if (!pages.includes(totalPages)) {
				pages.push(totalPages);
			}
		}

		return { startRecord: start, endRecord: end, pageNumbers: pages };
	}, [currentPage, totalRecords, pageSize, totalPages]);

	// Navigation handlers
	const goToPage = useCallback((page: number) => {
		if (page >= 1 && page <= totalPages && page !== currentPage) {
			onPageChange(page);
		}
	}, [currentPage, totalPages, onPageChange]);

	const goToFirst = useCallback(() => goToPage(1), [goToPage]);
	const goToPrev = useCallback(() => goToPage(currentPage - 1), [currentPage, goToPage]);
	const goToNext = useCallback(() => goToPage(currentPage + 1), [currentPage, goToPage]);
	const goToLast = useCallback(() => goToPage(totalPages), [totalPages, goToPage]);

	// Don't render if only one page or no records
	if (totalPages <= 1 || totalRecords === 0) {
		return showInfo && totalRecords > 0 ? (
			<div className={clsx("flex items-center justify-between py-3 px-1", className)}>
				<p className="text-sm text-gray-600">
					Showing <span className="font-medium text-gray-900">{startRecord}</span> to{" "}
					<span className="font-medium text-gray-900">{endRecord}</span> of{" "}
					<span className="font-medium text-gray-900">{totalRecords}</span> records
				</p>
			</div>
		) : null;
	}

	return (
		<div className={clsx("flex flex-col sm:flex-row items-center justify-between gap-3 py-3 px-1", className)}>
			{/* Record count indicator */}
			{showInfo && (
				<p className="text-sm text-gray-600 order-2 sm:order-1">
					Showing <span className="font-medium text-gray-900">{startRecord}</span> to{" "}
					<span className="font-medium text-gray-900">{endRecord}</span> of{" "}
					<span className="font-medium text-gray-900">{totalRecords}</span> records
				</p>
			)}

			{/* Pagination controls */}
			<nav className="flex items-center gap-1 order-1 sm:order-2" aria-label="Pagination">
				{/* First page button */}
				<button
					onClick={goToFirst}
					disabled={currentPage === 1}
					className={clsx(
						"p-1.5 rounded-md transition-all duration-150",
						currentPage === 1
							? "text-gray-300 cursor-not-allowed"
							: "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
					)}
					aria-label="First page"
					title="First page"
				>
					<ChevronsLeft className="h-4 w-4" />
				</button>

				{/* Previous button */}
				<button
					onClick={goToPrev}
					disabled={currentPage === 1}
					className={clsx(
						"p-1.5 rounded-md transition-all duration-150",
						currentPage === 1
							? "text-gray-300 cursor-not-allowed"
							: "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
					)}
					aria-label="Previous page"
					title="Previous"
				>
					<ChevronLeft className="h-4 w-4" />
				</button>

				{/* Page numbers */}
				<div className="flex items-center gap-1 mx-1">
					{pageNumbers.map((page, index) => (
						page === "..." ? (
							<span
								key={`ellipsis-${index}`}
								className="px-2 py-1 text-gray-400 text-sm"
							>
								...
							</span>
						) : (
							<button
								key={page}
								onClick={() => goToPage(page)}
								disabled={page === currentPage}
								className={clsx(
									"min-w-[32px] h-8 px-2 rounded-md text-sm font-medium transition-all duration-150",
									page === currentPage
										? "bg-[#388E3C] text-white shadow-sm cursor-default"
										: "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
								)}
								aria-label={`Page ${page}`}
								aria-current={page === currentPage ? "page" : undefined}
							>
								{page}
							</button>
						)
					))}
				</div>

				{/* Next button */}
				<button
					onClick={goToNext}
					disabled={currentPage === totalPages}
					className={clsx(
						"p-1.5 rounded-md transition-all duration-150",
						currentPage === totalPages
							? "text-gray-300 cursor-not-allowed"
							: "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
					)}
					aria-label="Next page"
					title="Next"
				>
					<ChevronRight className="h-4 w-4" />
				</button>

				{/* Last page button */}
				<button
					onClick={goToLast}
					disabled={currentPage === totalPages}
					className={clsx(
						"p-1.5 rounded-md transition-all duration-150",
						currentPage === totalPages
							? "text-gray-300 cursor-not-allowed"
							: "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
					)}
					aria-label="Last page"
					title="Last page"
				>
					<ChevronsRight className="h-4 w-4" />
				</button>
			</nav>
		</div>
	);
}

/**
 * Custom hook for pagination state management.
 * Handles page state and provides paginated data slice.
 */
export function usePagination<T>(
	data: T[],
	pageSize: number = 5
): {
	currentPage: number;
	setCurrentPage: (page: number) => void;
	paginatedData: T[];
	totalRecords: number;
	totalPages: number;
	resetPage: () => void;
} {
	const [currentPage, setCurrentPage] = React.useState(1);
	
	const totalRecords = data.length;
	const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
	
	// Ensure currentPage doesn't exceed totalPages when data changes
	const validPage = Math.min(currentPage, totalPages);
	if (validPage !== currentPage) {
		setCurrentPage(validPage);
	}
	
	const paginatedData = React.useMemo(() => {
		const startIndex = (validPage - 1) * pageSize;
		return data.slice(startIndex, startIndex + pageSize);
	}, [data, validPage, pageSize]);
	
	const resetPage = React.useCallback(() => {
		setCurrentPage(1);
	}, []);
	
	return {
		currentPage: validPage,
		setCurrentPage,
		paginatedData,
		totalRecords,
		totalPages,
		resetPage,
	};
}

// Need React import for the hook
import React from "react";
