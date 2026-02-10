import { createClient } from '@supabase/supabase-js'

/**
 * Supabase client configuration using environment variables.
 * 
 * Required environment variables:
 * - NEXT_PUBLIC_SUPABASE_URL: Your Supabase project URL
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY: Your Supabase anonymous/public key
 * 
 * For local development: Set in .env.local file
 * For production (Vercel): Set in Vercel Dashboard → Settings → Environment Variables
 */

// Get environment variables - Next.js inlines NEXT_PUBLIC_ variables at build time
// For production (Vercel), these are set in Vercel Dashboard → Settings → Environment Variables
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

// Create Supabase client with proper configuration
// Use singleton pattern to ensure only one client instance
// During build time, if env vars are missing, create a mock client to allow build to complete
export const supabase = (() => {
	// Only create client if we have valid credentials
	if (!supabaseUrl || !supabaseAnonKey) {
		// During build time, log warning but don't throw to allow build to complete
		// The mock client will be created and runtime validation will catch the issue
		if (typeof window === 'undefined' && process.env.NODE_ENV !== 'production') {
			console.warn('[Supabase] Missing environment variables during build. Build will continue but app will require env vars at runtime.');
		}
		// Return a mock client that will throw clear errors at runtime
		return createClient(
			'https://invalid.supabase.co',
			'invalid-key',
			{
				auth: {
					persistSession: false,
					autoRefreshToken: false,
					detectSessionInUrl: false,
				},
			}
		);
	}
	
	return createClient(
		supabaseUrl,
		supabaseAnonKey,
		{
			auth: {
				persistSession: true,
				autoRefreshToken: true,
				detectSessionInUrl: true,
				storage: typeof window !== 'undefined' ? window.localStorage : undefined,
				storageKey: 'sb-auth-token',
				flowType: 'pkce',
			},
			global: {
				headers: {
					'x-client-info': 'bitter-scan-expert-dashboard',
				},
			},
			realtime: {
				params: {
					eventsPerSecond: 10,
				},
				// Enable automatic reconnection with improved settings
				heartbeatIntervalMs: 30000, // 30 seconds - keep connection alive
				reconnectAfterMs: (tries: number) => {
					// Exponential backoff: 1s, 2s, 4s, 8s, max 30s
					// More aggressive reconnection for better reliability
					const delay = Math.min(1000 * Math.pow(2, tries), 30000);
					if (process.env.NODE_ENV === 'development') {
						console.log('[Realtime] 🔄 Reconnecting in', delay, 'ms (attempt', tries + 1, ')');
					}
					return delay;
				},
				// Timeout settings for better connection stability
				timeout: 20000, // 20 seconds timeout for operations
			},
		}
	);
})();

// Runtime validation helper - call this before making API calls
export function validateSupabaseClient(): void {
	if (typeof window === 'undefined') return; // Skip in SSR
	
	if (!supabaseUrl || !supabaseAnonKey) {
		const errorMessage = 'Supabase client is not properly configured. Please create a .env.local file with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.';
		console.error('[Supabase]', errorMessage);
		throw new Error(errorMessage);
	}
	
	// Additional validation for production - check if URLs are valid
	if (supabaseUrl === 'https://invalid.supabase.co' || supabaseAnonKey === 'invalid-key') {
		const errorMessage = 'Supabase client is not properly configured. Please check your environment variables in Vercel Dashboard → Settings → Environment Variables.';
		console.error('[Supabase]', errorMessage);
		throw new Error(errorMessage);
	}
}

// Helper function to listen for auth state changes
export function listenForSession(callback: (user: unknown) => void) {
	return supabase.auth.onAuthStateChange((_event, session) => {
		callback(session?.user || null)
	})
}
