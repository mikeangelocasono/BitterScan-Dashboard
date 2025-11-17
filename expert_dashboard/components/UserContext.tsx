"use client";

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import { supabase } from './supabase';
import { UserProfile, User, UserContextType, SupabaseApiError, isSupabaseApiError } from '../types';

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

    const getInitialSession = async () => {
      try {
        // Check for corrupted localStorage data before attempting to get session
        if (typeof window !== 'undefined') {
          try {
            const stored = localStorage.getItem(SUPABASE_STORAGE_KEY);
            if (stored) {
              JSON.parse(stored);
            }
          } catch (parseError) {
            // Corrupted localStorage data - clear it
            console.warn('Corrupted localStorage data detected, clearing...');
            await clearAuthAndSignOut();
            if (isMountedRef.current) {
              setLoading(false);
              initialResolved.current = true;
            }
            return;
          }
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        
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
        
        await resolveSession(session?.user ?? null);
      } catch (error: unknown) {
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
        if (isMountedRef.current) {
          setLoading(false);
          initialResolved.current = true;
        }
      }
    };

    getInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMountedRef.current) return;

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
      subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - resolveSession is stable and accessed via ref

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState !== 'visible' || !resolveSessionRef.current) return;
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();
        
        // Handle refresh token errors
        if (sessionError && isRefreshTokenError(sessionError)) {
          console.warn('Invalid refresh token detected on visibility change, clearing auth...');
          setUser(null);
          setProfile(null);
          await clearAuthAndSignOut();
          return;
        }
        
        if (sessionError) {
          throw sessionError;
        }
        
        await resolveSessionRef.current(session?.user ?? null);
      } catch (error: unknown) {
        // Handle refresh token errors
        if (isRefreshTokenError(error)) {
          console.warn('Invalid refresh token detected on visibility change (catch), clearing auth...');
          setUser(null);
          setProfile(null);
          await clearAuthAndSignOut();
        } else {
          console.error('Error refreshing session on visibility change:', error);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
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
