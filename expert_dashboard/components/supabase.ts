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
// Get environment variables - these are available at build time in Vercel
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Validate environment variables
// In production (Vercel), these should be set in Environment Variables settings
// During build, Vercel injects these values, so this check ensures they're present
if (!supabaseUrl || !supabaseAnonKey) {
	// Only throw error in client-side to prevent SSR build failures
	// This allows the build to complete, but the app will show errors at runtime if vars are missing
	if (typeof window !== 'undefined') {
		throw new Error(
			'Missing Supabase environment variables. Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in your environment variables (Vercel Dashboard → Settings → Environment Variables).'
		)
	}
	// In SSR/build, log warning but don't throw to allow build to complete
	// The client will handle the error when it hydrates
	console.warn(
		'[Supabase] Environment variables not found. Make sure to set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel environment variables.'
	)
}

// Create Supabase client
// If env vars are missing, createClient will still work but API calls will fail
// This allows the app to build successfully and show proper errors at runtime
export const supabase = createClient(
	supabaseUrl || '',
	supabaseAnonKey || '',
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
	}
)

// Suppress refresh token errors in console (handled gracefully by UserContext)
if (typeof window !== 'undefined') {
	const originalError = console.error;
	console.error = (...args: unknown[]) => {
		// Check if this is a refresh token error from Supabase
		const firstArg = args[0];
		let isRefreshTokenError = false;
		
		// Check string errors
		if (typeof firstArg === 'string') {
			const errorLower = firstArg.toLowerCase();
			isRefreshTokenError = 
				errorLower.includes('refresh token') ||
				errorLower.includes('refresh_token') ||
				errorLower.includes('refresh_token_not_found') ||
				errorLower.includes('invalid refresh token');
		}
		// Check Error objects
		else if (firstArg instanceof Error) {
			const errorLower = firstArg.message.toLowerCase();
			const errorName = firstArg.name.toLowerCase();
			isRefreshTokenError = 
				errorLower.includes('refresh token') ||
				errorLower.includes('refresh_token') ||
				errorLower.includes('refresh_token_not_found') ||
				errorLower.includes('invalid refresh token') ||
				errorName.includes('authapierror');
		}
		// Check object errors with message property
		else if (firstArg && typeof firstArg === 'object' && 'message' in firstArg) {
			const errorObj = firstArg as { message?: string; name?: string; code?: string };
			const errorLower = String(errorObj.message || '').toLowerCase();
			const errorCode = String(errorObj.code || '').toLowerCase();
			isRefreshTokenError = 
				errorLower.includes('refresh token') ||
				errorLower.includes('refresh_token') ||
				errorLower.includes('refresh_token_not_found') ||
				errorLower.includes('invalid refresh token') ||
				errorCode.includes('refresh_token') ||
				errorCode === 'refresh_token_not_found';
		}
		// Check all args as string
		else {
			const allArgsString = args.map(arg => String(arg)).join(' ').toLowerCase();
			isRefreshTokenError = 
				allArgsString.includes('refresh token') ||
				allArgsString.includes('refresh_token') ||
				allArgsString.includes('refresh_token_not_found') ||
				allArgsString.includes('invalid refresh token');
		}
		
		// Suppress refresh token errors (UserContext handles them gracefully)
		if (isRefreshTokenError) {
			// Silently ignore - UserContext will handle sign out automatically
			return;
		}
		
		// Log other errors normally
		originalError.apply(console, args);
	};
}

// Helper function to listen for auth state changes
export function listenForSession(callback: (user: unknown) => void) {
	return supabase.auth.onAuthStateChange((_event, session) => {
		callback(session?.user || null)
	})
}
