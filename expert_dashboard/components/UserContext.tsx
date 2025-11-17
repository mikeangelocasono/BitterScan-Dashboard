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
  const initialResolved = useRef(false);
  const isMountedRef = useRef(true);
  const resolveSessionRef = useRef<typeof resolveSession | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const sessionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileData) {
        setProfile(profileData);
        return;
      }

      if (profileError?.code === 'PGRST116') {
        // Profile intentionally missing (not created yet)
        setProfile(null);
        return;
      }

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        setProfile(null);
      }
    } catch (error: unknown) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) {
      await fetchProfile(user.id);
    }
  }, [fetchProfile, user]);

  const resolveSession = useCallback(
    async (sessionUser: User | null) => {
      if (!isMountedRef.current) return;
      setUser(sessionUser);

      if (sessionUser) {
        await fetchProfile(sessionUser.id);
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

  const logout = useCallback(async () => {
    // Immediately clear local state for instant UI response
    setUser(null);
    setProfile(null);

    if (typeof window !== 'undefined') {
      sessionStorage.setItem(SUPPRESS_AUTH_TOAST_KEY, 'true');
    }

    // Clear all auth data and sign out
    await clearAuthAndSignOut();
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
        // Reduced to 6 seconds to match getSession timeout + buffer
        timeoutRef.current = setTimeout(() => {
          if (isMountedRef.current && !initialResolved.current) {
            console.warn('[UserContext] Session fetch timeout - clearing loading state');
            setLoading(false);
            initialResolved.current = true;
            // If we haven't resolved a session by now, there likely isn't one
            // Set user to null to allow login flow
            if (!user) {
              setUser(null);
              setProfile(null);
            }
          }
        }, 6000); // 6 second timeout (4s for getSession + 2s buffer)

        // Validate Supabase client before attempting session
        try {
          validateSupabaseClient();
        } catch (err) {
          console.error('[UserContext] Supabase client validation failed:', err instanceof Error ? err.message : String(err));
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          if (isMountedRef.current) {
            setLoading(false);
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
          }, 4000); // 4 second timeout
          
          try {
            const sessionPromise = supabase.auth.getSession();
            const timeoutPromise = new Promise<never>((_, reject) => {
              sessionTimeoutRef.current = setTimeout(() => {
                reject(new Error('Session fetch timeout'));
              }, 4000);
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
            if (shouldShowSpinner) {
              setLoading(false);
            }
            initialResolved.current = true;
          }
          return;
        }

        // Handle SIGNED_OUT event - ensure state is cleared
        if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
          if (isMountedRef.current) {
            if (shouldShowSpinner) {
              setLoading(false);
            }
            initialResolved.current = true;
          }
          return;
        }

        // Handle SIGNED_IN event - update user state immediately
        // This is critical for login flow - don't block on profile fetch
        if (event === 'SIGNED_IN' && session?.user) {
          // Update user immediately for login redirect
          setUser(session.user);
          // Fetch profile in background (don't await - let it update async)
          fetchProfile(session.user.id).catch(err => {
            console.error('Error fetching profile after sign in:', err);
          });
          
          if (isMountedRef.current) {
            if (shouldShowSpinner) {
              setLoading(false);
            }
            initialResolved.current = true;
          }
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
          await clearAuthAndSignOut();
        } else {
          console.error('Error in auth state change:', error);
        }
      } finally {
        if (isMountedRef.current) {
          if (shouldShowSpinner) {
            setLoading(false);
          }
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

  useEffect(() => {
    if (typeof document === 'undefined') return;

    // Add debounce to prevent rapid-fire session checks
    let visibilityTimeout: NodeJS.Timeout | null = null;
    let isChecking = false;

    const handleVisibilityChange = async () => {
      // Only check if tab becomes visible and we're not already checking
      if (document.visibilityState !== 'visible' || !resolveSessionRef.current || isChecking) return;
      
      // Clear any pending timeout
      if (visibilityTimeout) {
        clearTimeout(visibilityTimeout);
      }
      
      // Debounce the check to prevent rapid calls
      visibilityTimeout = setTimeout(async () => {
        if (!resolveSessionRef.current || isChecking) return;
        isChecking = true;
        
        try {
          // Add timeout to prevent hanging
          const sessionPromise = supabase.auth.getSession();
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Session check timeout')), 3000);
          });
          
          const result = await Promise.race([sessionPromise, timeoutPromise]);
          const { data: { session }, error: sessionError } = result;
          
          // Handle refresh token errors
          if (sessionError && isRefreshTokenError(sessionError)) {
            console.warn('Invalid refresh token detected on visibility change, clearing auth...');
            setUser(null);
            setProfile(null);
            await clearAuthAndSignOut();
            isChecking = false;
            return;
          }
          
          if (sessionError) {
            throw sessionError;
          }
          
          // Only update if session actually changed to prevent unnecessary re-renders
          if (resolveSessionRef.current) {
            await resolveSessionRef.current(session?.user ?? null);
          }
        } catch (error: unknown) {
          // Handle timeout and refresh token errors
          if (error instanceof Error && error.message.includes('timeout')) {
            // Timeout is expected in some cases, don't log as error
            console.warn('[UserContext] Session check timeout on visibility change');
          } else if (isRefreshTokenError(error)) {
            console.warn('Invalid refresh token detected on visibility change (catch), clearing auth...');
            setUser(null);
            setProfile(null);
            await clearAuthAndSignOut();
          } else {
            console.error('Error refreshing session on visibility change:', error);
          }
        } finally {
          isChecking = false;
        }
      }, 500); // 500ms debounce
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      if (visibilityTimeout) {
        clearTimeout(visibilityTimeout);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // Empty deps - use ref to access latest resolveSession

  return (
    <UserContext.Provider value={{ user, profile, loading, refreshProfile, logout }}>
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
