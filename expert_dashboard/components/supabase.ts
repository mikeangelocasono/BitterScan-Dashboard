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
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
	const errorMessage = typeof window !== 'undefined'
		? 'Supabase client is not properly configured. Please create a .env.local file with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
		: 'Missing Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.';
	
	if (typeof window !== 'undefined') {
		console.error('[Supabase]', errorMessage);
	} else {
		throw new Error(errorMessage);
	}
}

// Create Supabase client with proper configuration
export const supabase = createClient(
	supabaseUrl!,
	supabaseAnonKey!,
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
		},
	}
);

// Runtime validation helper - call this before making API calls
export function validateSupabaseClient(): void {
	if (typeof window === 'undefined') return; // Skip in SSR
	
	if (!supabaseUrl || !supabaseAnonKey) {
		const errorMessage = 'Supabase client is not properly configured. Please create a .env.local file with NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.';
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
