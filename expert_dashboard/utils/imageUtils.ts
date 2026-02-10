/**
 * Utility functions for constructing Supabase storage image URLs
 * 
 * The scan-images bucket now has two folders:
 * - leaf_scans: for leaf disease scans
 * - fruit_scans: for fruit ripeness scans
 */

import { Scan } from "@/types";

/**
 * Constructs the public URL for a scan image based on scan type and UUID
 * 
 * @param scan - The scan object with scan_type and scan_uuid
 * @param fileExtension - Optional file extension (default: 'jpg'). Common formats: jpg, jpeg, png, webp
 * @returns The public URL for the image, or null if scan_uuid is missing
 * 
 * @example
 * const url = getScanImageUrl(scan); // Uses default .jpg extension
 * const url = getScanImageUrl(scan, 'png'); // Uses .png extension
 */
export function getScanImageUrl(scan: Scan | null | undefined, fileExtension: string = 'jpg'): string | null {
	if (!scan || !scan.scan_uuid) {
		return null;
	}

	const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
	if (!supabaseUrl) {
		if (process.env.NODE_ENV === 'development') {
			console.error('[ImageUtils] NEXT_PUBLIC_SUPABASE_URL is not configured');
		}
		return null;
	}

	// Ensure scan_uuid is a string and trim any whitespace
	const scanUuid = String(scan.scan_uuid).trim();
	if (!scanUuid) {
		return null;
	}

	// Determine folder based on scan type
	// Handle both 'leaf_disease' and 'fruit_maturity' scan types
	const folder = scan.scan_type === 'leaf_disease' ? 'leaf_scans' : 'fruit_scans';
	
	// Normalize file extension (remove leading dot if present, convert to lowercase)
	const ext = fileExtension.replace(/^\./, '').toLowerCase();
	
	// Construct the public URL
	// Format: https://[project-ref].supabase.co/storage/v1/object/public/scan-images/[folder]/[scan_uuid].[ext]
	// Note: Do NOT encode UUID - Supabase storage paths should use raw UUID strings
	const imageUrl = `${supabaseUrl}/storage/v1/object/public/scan-images/${folder}/${scanUuid}.${ext}`;
	
	// Only log in development mode for debugging
	if (process.env.NODE_ENV === 'development') {
		console.log('[ImageUtils] Generated image URL:', {
			scan_uuid: scanUuid,
			scan_type: scan.scan_type,
			folder,
			extension: ext,
			full_url: imageUrl
		});
	}
	
	return imageUrl;
}

/**
 * Attempts to get the scan image URL by trying multiple common file extensions
 * This is useful when the exact file extension is unknown
 * 
 * @param scan - The scan object with scan_type and scan_uuid
 * @returns The first URL with .jpg extension (most common), or null if scan_uuid is missing
 * Note: The browser will try to load this URL, and if it fails, the onError handler will catch it
 */
export function getScanImageUrlWithFallback(scan: Scan | null | undefined): string | null {
	if (!scan || !scan.scan_uuid) {
		return null;
	}

	// Try common image extensions in order of likelihood
	// Start with jpg as it's the most common format
	const extensions = ['jpg', 'jpeg', 'png', 'webp'];
	
	// Return the first URL constructed (browser will try to load it)
	// If it doesn't exist, the onError handler will catch it and try next extension
	const url = getScanImageUrl(scan, extensions[0]);
	return url || null;
}

/**
 * Gets the next URL in the fallback sequence for an image that failed to load
 * This allows trying multiple file extensions when one fails
 * 
 * @param scan - The scan object with scan_type and scan_uuid
 * @param currentUrl - The URL that failed to load
 * @returns The next URL to try, or null if no more extensions to try
 */
export function getNextImageUrlFallback(scan: Scan | null | undefined, currentUrl: string | null): string | null {
	if (!scan || !scan.scan_uuid || !currentUrl) {
		return null;
	}

	const extensions = ['jpg', 'jpeg', 'png', 'webp'];
	
	// Extract the current extension from the URL
	const urlMatch = currentUrl.match(/\.([a-z]+)$/i);
	const currentExt = urlMatch ? urlMatch[1].toLowerCase() : null;
	
	// Find the index of the current extension
	const currentIndex = currentExt ? extensions.indexOf(currentExt) : -1;
	
	// If we found the current extension and there's a next one, try it
	if (currentIndex >= 0 && currentIndex < extensions.length - 1) {
		return getScanImageUrl(scan, extensions[currentIndex + 1]);
	}
	
	return null;
}

/**
 * Gets all possible image URLs for a scan (all extensions)
 * Useful for debugging or trying multiple URLs
 * 
 * @param scan - The scan object with scan_type and scan_uuid
 * @returns Array of possible image URLs
 */
export function getAllPossibleImageUrls(scan: Scan | null | undefined): string[] {
	if (!scan || !scan.scan_uuid) {
		return [];
	}

	const extensions = ['jpg', 'jpeg', 'png', 'webp'];
	const urls: string[] = [];
	
	for (const ext of extensions) {
		const url = getScanImageUrl(scan, ext);
		if (url) {
			urls.push(url);
		}
	}

	return urls;
}

/**
 * Checks if an image URL is from the new folder structure
 * 
 * @param url - The image URL to check
 * @returns true if the URL is from leaf_scans or fruit_scans folders
 */
export function isNewImageUrl(url: string | null | undefined): boolean {
	if (!url) return false;
	return url.includes('/leaf_scans/') || url.includes('/fruit_scans/');
}

/**
 * Gets a placeholder image URL for when scan images are missing
 * 
 * @returns A placeholder image URL or data URI
 */
export function getPlaceholderImageUrl(): string {
	// Return a simple SVG placeholder as data URI
	return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23f3f4f6' width='400' height='300'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='system-ui' font-size='16' fill='%239ca3af'%3EImage not available%3C/text%3E%3C/svg%3E";
}

