"use client";

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import { supabase, validateSupabaseClient } from './supabase';
import { UserProfile, User, UserContextType, isSupabaseApiError } from '../types';

const SUPPRESS_AUTH_TOAST_KEY = 'bs:suppress-auth-toast';
const SUPABASE_STORAGE_KEY = 'sb-auth-token';

const UserContext = createContext<UserContextType | undefined>(undefined);

/**
 * Helper function to check if an error is related to invalid/missing refresh token
 */
function isRefreshTokenError(error: unknown): boolean {
  // Check for string errors
  if (typeof error === 'string') {
    const errorLower = error.toLowerCase();
    return (
      errorLower.includes('refresh token') ||
      errorLower.includes('refresh_token') ||
      errorLower.includes('refresh_token_not_found') ||
      errorLower.includes('invalid refresh token')
    );
  }
  
  // Check for Error objects
  if (error instanceof Error) {
    const errorLower = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();
    return (
      errorLower.includes('refresh token') ||
      errorLower.includes('refresh_token') ||
      errorLower.includes('refresh_token_not_found') ||
      errorLower.includes('invalid refresh token') ||
      errorName.includes('authapierror')
    );
  }
  
  // Check for Supabase API errors
  if (!isSupabaseApiError(error)) return false;
  
  const errorMessage = (error.message || '').toLowerCase();
  const errorCode = (error.code || '').toLowerCase();
  
  return (
    errorMessage.includes('refresh token') ||
    errorMessage.includes('refresh_token') ||
    errorMessage.includes('refresh_token_not_found') ||
    errorMessage.includes('invalid refresh token') ||
    errorCode.includes('refresh_token') ||
    errorCode === 'refresh_token_not_found' ||
    (error.status === 401 && (errorMessage.includes('token') || errorMessage.includes('refresh'))) ||
    (error.status === 400 && errorMessage.includes('refresh'))
  );
}

function isPermissionDeniedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

/**
 * Wraps a promise with a timeout. Returns defaultValue if timeout is exceeded.
 * Prevents hanging promises from causing infinite loading states.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  defaultValue: T,
  label = 'operation'
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.warn(`[UserContext] ${label} timed out after ${timeoutMs}ms, using default value`);
      resolve(defaultValue);
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    return result;
  } catch (error) {
    clearTimeout(timeoutHandle!);
    throw error;
  }
}

  const code = (error as { code?: string | number }).code?.toString().toUpperCase();
  const status = (error as { status?: number }).status;
  const message = ((error as { message?: string }).message || '').toLowerCase();

  return (
    code === '42501' || // Postgres insufficient privilege / RLS
    code === 'PGRST301' ||
    status === 403 ||
    message.includes('rls') ||
    message.includes('policy') ||
    message.includes('permission')
  );
}

function buildAdminFallbackProfile(authUser: User): UserProfile {
  const fallbackUsername = (authUser.email || '').split('@')[0] || 'admin';
  const fullName = authUser.user_metadata?.full_name || 'MAGRO Head Expert';
  const email = authUser.email || '';
  const now = new Date().toISOString();

  return {
    id: authUser.id,
    email,
    username: fallbackUsername,
    full_name: fullName,
    role: 'admin',
    status: 'approved',
    created_at: now,
    updated_at: now,
  };
}

/**
 * Helper function to safely clear all auth-related data and sign out
 */
async function clearAuthAndSignOut(): Promise<void> {
  // Clear localStorage
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem(SUPABASE_STORAGE_KEY);
      // Clear any other potential auth-related keys
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('sb-') || key.includes('auth'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch (error) {
      console.warn('Error clearing localStorage:', error);
    }
    
    // Clear sessionStorage
    try {
      sessionStorage.clear();
    } catch (error) {
      console.warn('Error clearing sessionStorage:', error);
    }
  }
  
  // Sign out from Supabase
  try {
    await supabase.auth.signOut();
  } catch (error) {
    // Ignore sign-out errors - we've already cleared local storage
    console.warn('Error during signOut (ignored):', error);
  }
}

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // sessionReady signals that initial session resolution is complete
  // (user + profile loaded or confirmed null). Use this to gate data fetches.
  const [sessionReady, setSessionReady] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const loggingOutRef = useRef(false);
  const initialResolved = useRef(false);
  const isMountedRef = useRef(true);
  const resolveSessionRef = useRef<typeof resolveSession | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sessionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Track if a login-triggered profile fetch is already in progress to prevent duplicates
  const profileFetchInProgressRef = useRef(false);
  // Track state via refs for visibility handler (avoids stale closures)
  const loadingRef = useRef(true);
  const sessionReadyRef = useRef(false);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      // Add 10s timeout to prevent hanging after tab switch
      const fetchPromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      const { data: profileData, error: profileError } = await withTimeout(
        fetchPromise,
        10000,
        { data: null, error: null },
        'fetchProfile'
      );

      // RBAC: Successfully fetched profile data
      if (profileData) {
        // Normalize admin status
        if (profileData.role === 'admin' && profileData.status !== 'approved') {
          try {
            const { data: normalized, error: normError } = await supabase
              .from('profiles')
              .update({ status: 'approved' })
              .eq('id', userId)
              .select('*')
              .single();

            if (!normError && normalized) {
              setProfile(normalized as UserProfile);
              return;
            }
          } catch {
            // Fall through to set local profile with approved status
          }
          setProfile({ ...profileData, status: 'approved' } as UserProfile);
          return;
        }

        setProfile(profileData as UserProfile);
        return;
      }

      // Handle specific Supabase error codes - check if error object has actual content
      if (profileError && Object.keys(profileError).length > 0) {
        const isMissing = profileError.code === 'PGRST116';
        const authUserRes = await supabase.auth.getUser();
        const authUser = authUserRes?.data?.user || authUserRes?.user;
        const isAdminCandidate = authUser?.user_metadata?.role === 'admin' || (authUser?.email || '').toLowerCase().includes('admin');

        // If profile is missing or RLS blocked the read, bootstrap admin so login flow can continue
        if (authUser && isAdminCandidate && (isMissing || isPermissionDeniedError(profileError))) {
          try {
            const { data: upsertedProfile } = await supabase
              .from('profiles')
              .upsert({
                id: authUser.id,
                email: authUser.email || '',
                full_name: authUser.user_metadata?.full_name || 'MAGRO Head Expert',
                username: (authUser.email || '').split('@')[0] || 'admin',
                role: 'admin',
                status: 'approved',
              })
              .select('*')
              .single();

            if (upsertedProfile) {
              setProfile(upsertedProfile as UserProfile);
              return;
            }
          } catch (upsertError) {
            // Admin profile upsert failed - using fallback
          }

          // Fallback to in-memory profile so guards can proceed
          setProfile(buildAdminFallbackProfile(authUser as User));
          return;
        }

        // Log detailed error information for debugging
        const errorDetails = {
          code: profileError.code || 'UNKNOWN',
          message: profileError.message || 'Unknown error',
          status: profileError.status || 'Unknown status',
          hint: profileError.hint || 'No hint available',
          details: profileError.details || 'No details available',
        };
        
        // Profile fetch completed with no data - user may not have profile created yet
        
        setProfile(null);
        return;
      }

      // This case handles when both data and error are null (unexpected)
      setProfile(null);
    } catch (error: unknown) {
      // Handle unexpected runtime errors
      setProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(async (userId?: string) => {
    const targetId = userId || user?.id;
    if (targetId) {
      try {
        await fetchProfile(targetId);
      } catch (error) {
        console.warn('[UserContext] refreshProfile error:', error);
        // Don't re-throw - let caller handle via .catch() if needed
      }
    }
  }, [fetchProfile, user?.id]);

  const resolveSession = useCallback(
    async (sessionUser: User | null) => {
      if (!isMountedRef.current) return;
      setUser(sessionUser);
      
      // Mark session as ready IMMEDIATELY after setting user
      // Don't wait for profile - DataContext uses Bearer token for auth
      // Profile will load in parallel
      if (isMountedRef.current) {
        setSessionReady(true);
      }

      // Fetch profile in parallel (non-blocking)
      if (sessionUser) {
        fetchProfile(sessionUser.id).catch((err) => {
          console.warn('[UserContext] Profile fetch error (non-blocking):', err);
        });
      } else {
        setProfile(null);
      }
    },
    [fetchProfile]
  );

  // Keep ref updated with latest resolveSession function
  useEffect(() => {
    resolveSessionRef.current = resolveSession;
  }, [resolveSession]);

  // Sync loadingRef with loading state for visibility handler
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  // Sync sessionReadyRef with sessionReady state for visibility handler
  useEffect(() => {
    sessionReadyRef.current = sessionReady;
  }, [sessionReady]);

  const logout = useCallback(async () => {
    // Signal logout in progress — prevents AuthGuard redirect and shows overlay
    setLoggingOut(true);
    loggingOutRef.current = true;

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SUPPRESS_AUTH_TOAST_KEY, 'true');
      sessionStorage.setItem('bs:from-logout', 'true');
    }

    // Sign out from Supabase first
    await clearAuthAndSignOut();

    // Clear local state
    setUser(null);
    setProfile(null);
    setSessionReady(false);

    // Minimal delay for visual feedback then immediate redirect
    await new Promise(resolve => setTimeout(resolve, 300));

    // Reset loggingOut state
    setLoggingOut(false);
    loggingOutRef.current = false;
    
    // Immediate redirect to role-select page
    if (typeof window !== 'undefined') {
      window.location.href = '/role-select';
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    // Clear any existing timeouts
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
    timeoutRef.current = null;
    sessionTimeoutRef.current = null;

    const getInitialSession = async () => {
      try {
        // Set a timeout to prevent infinite loading in production
        // 1.5 seconds: ultra-fast fallback for instant UX
        timeoutRef.current = setTimeout(() => {
          if (isMountedRef.current && !initialResolved.current) {
            console.warn('[UserContext] Session fetch timeout - clearing loading state');
            setLoading(false);
            setSessionReady(true); // Mark session as ready even on timeout to allow UI to proceed
            initialResolved.current = true;
            // If we haven't resolved a session by now, there likely isn't one
            // Set user to null to allow login flow
            if (!user) {
              setUser(null);
              setProfile(null);
            }
          }
        }, 1500); // 1.5 second timeout for ultra-fast UX

        // Validate Supabase client before attempting session
        try {
          validateSupabaseClient();
        } catch (err) {
          console.error('[UserContext] Supabase client validation failed:', err instanceof Error ? err.message : String(err));
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          if (isMountedRef.current) {
            setLoading(false);
            setSessionReady(true);
            initialResolved.current = true;
          }
          return;
        }

        // Check for corrupted localStorage data before attempting to get session
        if (typeof window !== 'undefined') {
          try {
            const stored = localStorage.getItem(SUPABASE_STORAGE_KEY);
            if (stored) {
              JSON.parse(stored);
            }
          } catch {
            // Corrupted localStorage data - clear it
            console.warn('Corrupted localStorage data detected, clearing...');
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            await clearAuthAndSignOut();
            if (isMountedRef.current) {
              setLoading(false);
              setSessionReady(true);
              initialResolved.current = true;
            }
            return;
          }
        }

        // Only attempt to get session if credentials are valid
        // This prevents "Failed to fetch" errors when env vars are missing
        let session = null;
        let sessionError = null;
        
        try {
          // Add timeout to getSession call to prevent hanging
          // Use AbortController for better timeout handling
          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
          }, 1500); // 1.5 second timeout for ultra-fast UX
          
          try {
            const sessionPromise = supabase.auth.getSession();
            const timeoutPromise = new Promise<never>((_, reject) => {
              sessionTimeoutRef.current = setTimeout(() => {
                reject(new Error('Session fetch timeout'));
              }, 1500); // 1.5 seconds for ultra-fast UX
            });
            
            const result = await Promise.race([sessionPromise, timeoutPromise]);
            clearTimeout(timeoutId);
            if (sessionTimeoutRef.current) {
              clearTimeout(sessionTimeoutRef.current);
              sessionTimeoutRef.current = null;
            }
            session = result.data?.session || null;
            sessionError = result.error || null;
          } catch (raceError) {
            clearTimeout(timeoutId);
            if (sessionTimeoutRef.current) {
              clearTimeout(sessionTimeoutRef.current);
              sessionTimeoutRef.current = null;
            }
            throw raceError;
          }
        } catch (err) {
          // Catch network errors and timeouts
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (errorMessage.includes('Failed to fetch') || 
              errorMessage.includes('fetch') || 
              errorMessage.includes('NetworkError') ||
              errorMessage.includes('timeout') ||
              errorMessage.includes('aborted')) {
            // Expected error when credentials are invalid or network issues
            console.warn('[UserContext] Session fetch failed:', errorMessage);
            sessionError = null; // Clear error to allow graceful handling
            session = null;
            // Don't throw - allow graceful fallback to no session
          } else {
            throw err; // Re-throw unexpected errors
          }
        }
        
        // Clear timeouts if we got here
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
        
        // Handle refresh token errors
        if (sessionError && isRefreshTokenError(sessionError)) {
          // Invalid refresh token - clear session and sign out
          console.warn('Invalid refresh token detected in getSession, clearing auth...');
          setUser(null);
          setProfile(null);
          await clearAuthAndSignOut();
          if (isMountedRef.current) {
            setLoading(false);
            setSessionReady(true);
            initialResolved.current = true;
          }
          return;
        }
        
        if (sessionError) {
          throw sessionError;
        }
        
        // Resolve session (even if null - this allows login flow to proceed)
        await resolveSession(session?.user ?? null);
        
        // Ensure loading is cleared after session resolution
        // Note: resolveSession already sets sessionReady = true
        if (isMountedRef.current) {
          setLoading(false);
          initialResolved.current = true;
        }
      } catch (error: unknown) {
        // Clear timeouts on error
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
        
        // Handle refresh token errors
        if (isRefreshTokenError(error)) {
          console.warn('Invalid refresh token detected in getSession catch, clearing auth...');
          setUser(null);
          setProfile(null);
          await clearAuthAndSignOut();
        } else if (error instanceof SyntaxError || (error instanceof Error && error.message.includes('JSON'))) {
          // JSON parsing error from corrupted localStorage
          console.warn('JSON parsing error detected, clearing auth...');
          setUser(null);
          setProfile(null);
          await clearAuthAndSignOut();
        } else {
          console.error('Error getting initial session:', error);
        }
      } finally {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
        if (isMountedRef.current) {
          setLoading(false);
          setSessionReady(true);
          initialResolved.current = true;
        }
      }
    };

    getInitialSession();

    // Set up auth state change listener - only once
    // This listener handles all auth state changes (login, logout, token refresh, etc.)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Guard: Don't process if component is unmounted
      if (!isMountedRef.current) return;

      // Only show spinner if initial session hasn't been resolved yet
      // This prevents showing spinner during normal auth state changes (like login)
      const shouldShowSpinner = !initialResolved.current;
      if (shouldShowSpinner) {
        setLoading(true);
      }

      try {
        // Handle TOKEN_REFRESHED event - if session is null, token refresh failed
        if (event === 'TOKEN_REFRESHED' && !session) {
          // Token refresh failed - clear auth and sign out
          console.warn('Token refresh failed (no session), clearing auth...');
          setUser(null);
          setProfile(null);
          await clearAuthAndSignOut();
          if (isMountedRef.current) {
            setSessionReady(true);
            if (shouldShowSpinner) {
              setLoading(false);
            }
            initialResolved.current = true;
          }
          return;
        }

        // Handle SIGNED_OUT event - ensure state is cleared
        if (event === 'SIGNED_OUT') {
          // During explicit logout, skip state clearing here — logout() handles it
          if (loggingOutRef.current) {
            if (isMountedRef.current) {
              initialResolved.current = true;
            }
            return;
          }
          setUser(null);
          setProfile(null);
          setSessionReady(false);
          if (isMountedRef.current) {
            if (shouldShowSpinner) {
              setLoading(false);
            }
            initialResolved.current = true;
          }
          return;
        }

        // Handle SIGNED_IN event - update user state and fetch profile in parallel
        // Set sessionReady IMMEDIATELY so DataContext can start fetching data right away
        // Profile loads in the background (non-blocking) for faster dashboard rendering
        if (event === 'SIGNED_IN' && session?.user) {
          // Skip if another profile fetch is already in progress (e.g., from login page)
          if (profileFetchInProgressRef.current) {
            // Just update user, profile will be set by the other fetch
            setUser(session.user);
            // CRITICAL: Still set sessionReady so downstream components don't hang
            if (isMountedRef.current) {
              setSessionReady(true);
              initialResolved.current = true;
            }
            return;
          }
          
          profileFetchInProgressRef.current = true;

          // Set user and mark session ready IMMEDIATELY — don't block on profile fetch
          // This lets DataContext start fetching data right away while profile loads in parallel
          setUser(session.user);

          if (isMountedRef.current) {
            initialResolved.current = true;
            setSessionReady(true);
            setLoading(false);
          }

          // Fetch profile in parallel (non-blocking)
          fetchProfile(session.user.id)
            .catch((err) => {
              console.warn('[UserContext] SIGNED_IN profile fetch failed:', err);
            })
            .finally(() => {
              profileFetchInProgressRef.current = false;
            });
          return;
        }

        // For other events, use resolveSession
        await resolveSession(session?.user ?? null);
      } catch (error: unknown) {
        // Handle refresh token errors silently (expected behavior when token is invalid)
        if (isRefreshTokenError(error)) {
          // Suppress console error for expected refresh token failures
          // This is expected when token expires or is invalid
          setUser(null);
          setProfile(null);
          setSessionReady(true);
          await clearAuthAndSignOut();
        } else {
          console.error('Error in auth state change:', error);
        }
      } finally {
        if (isMountedRef.current) {
          if (shouldShowSpinner) {
            setLoading(false);
          }
          setSessionReady(true);
          initialResolved.current = true;
        }
      }
    });

    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (sessionTimeoutRef.current) clearTimeout(sessionTimeoutRef.current);
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - resolveSession is stable and accessed via ref

  // Track current user ID via ref to compare in visibility handler
  const currentUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentUserIdRef.current = user?.id ?? null;
  }, [user?.id]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Add debounce to prevent rapid-fire session checks
    let visibilityTimeout: NodeJS.Timeout | null = null;
    let isChecking = false;

    const handleVisibilityChange = async () => {
      // Only check if tab becomes visible and we're not already checking
      if (document.visibilityState !== 'visible' || isChecking) return;
      
      // If we're currently logging out, skip visibility check entirely
      if (loggingOutRef.current) return;
      
      // Clear any pending timeout
      if (visibilityTimeout) {
        clearTimeout(visibilityTimeout);
      }
      
      // CRITICAL FIX: Force-clear any stuck loading state on visibility change
      // This prevents infinite loading when returning to the tab
      // Use loadingRef.current to avoid stale closure issues
      if (loadingRef.current && initialResolved.current) {
        console.log('[UserContext] Visibility change: clearing stuck loading state');
        setLoading(false);
      }
      
      // Debounce the check to prevent rapid calls
      visibilityTimeout = setTimeout(async () => {
        if (isChecking || loggingOutRef.current) return;
        isChecking = true;
        
        try {
          // Add timeout to prevent hanging - reduced to 8 seconds for better UX
          const sessionPromise = supabase.auth.getSession();
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Session check timeout')), 8000);
          });
          
          const result = await Promise.race([sessionPromise, timeoutPromise]);
          const { data: { session }, error: sessionError } = result;
          
          // Handle refresh token errors
          if (sessionError && isRefreshTokenError(sessionError)) {
            console.warn('Invalid refresh token detected on visibility change, clearing auth...');
            setUser(null);
            setProfile(null);
            setLoading(false); // Ensure loading is cleared
            setSessionReady(true); // Ensure session is marked as ready
            await clearAuthAndSignOut();
            isChecking = false;
            return;
          }
          
          if (sessionError) {
            throw sessionError;
          }
          
          // CRITICAL: Only call resolveSession if the user has ACTUALLY changed
          // Comparing user IDs prevents unnecessary state updates and re-renders
          const sessionUserId = session?.user?.id ?? null;
          const currentUserId = currentUserIdRef.current;
          
          // Skip if user hasn't changed - this prevents infinite loading loops
          if (sessionUserId === currentUserId) {
            // Session is the same, no need to update anything
            // Just ensure loading is cleared and session is ready
            if (loadingRef.current) setLoading(false);
            if (!sessionReadyRef.current) setSessionReady(true);
            isChecking = false;
            return;
          }
          
          // User has actually changed (login/logout happened in another tab)
          // Only then should we call resolveSession
          if (resolveSessionRef.current) {
            await resolveSessionRef.current(session?.user ?? null);
          }
        } catch (error: unknown) {
          // Handle timeout and refresh token errors
          if (error instanceof Error && error.message.includes('timeout')) {
            // Timeout - ensure loading is cleared to prevent stuck state
            console.warn('[UserContext] Session check timeout on visibility change');
            if (loadingRef.current) setLoading(false);
            if (!sessionReadyRef.current) setSessionReady(true);
          } else if (isRefreshTokenError(error)) {
            console.warn('Invalid refresh token detected on visibility change (catch), clearing auth...');
            setUser(null);
            setProfile(null);
            setLoading(false);
            setSessionReady(true);
            await clearAuthAndSignOut();
          } else {
            console.error('Error refreshing session on visibility change:', error);
            // Even on error, ensure loading is cleared to prevent stuck state
            if (loadingRef.current) setLoading(false);
            if (!sessionReadyRef.current) setSessionReady(true);
          }
        } finally {
          isChecking = false;
        }
      }, 300); // Reduced to 300ms debounce for faster recovery
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      if (visibilityTimeout) {
        clearTimeout(visibilityTimeout);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - uses refs for all mutable state to avoid stale closures

  return (
    <UserContext.Provider value={{ user, profile, loading, sessionReady, loggingOut, refreshProfile, logout }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
