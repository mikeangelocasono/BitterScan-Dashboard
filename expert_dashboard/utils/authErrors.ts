/**
 * Authentication Error Handling Utilities
 * Provides consistent error messages and handling for authentication flows
 */

export interface AuthError {
  code: string;
  message: string;
  userFriendlyMessage: string;
}

export const AUTH_ERRORS = {
  // Expert role validation
  ROLE_MISMATCH: {
    code: 'ROLE_MISMATCH',
    message: 'User role does not match expert requirements',
    userFriendlyMessage: 'You are not allowed to log in here because your role does not match.'
  },
  
  // Credential errors
  INVALID_CREDENTIALS: {
    code: 'INVALID_CREDENTIALS',
    message: 'Invalid login credentials',
    userFriendlyMessage: 'Incorrect email or password. Please try again.'
  },
  
  // Email validation
  EMAIL_NOT_CONFIRMED: {
    code: 'EMAIL_NOT_CONFIRMED',
    message: 'Email not confirmed',
    userFriendlyMessage: 'Please check your email and confirm your account before signing in.'
  },
  
  // Rate limiting
  TOO_MANY_REQUESTS: {
    code: 'TOO_MANY_REQUESTS',
    message: 'Too many requests',
    userFriendlyMessage: 'Too many attempts. Please try again later.'
  },
  
  // Registration errors
  EMAIL_ALREADY_EXISTS: {
    code: 'EMAIL_ALREADY_EXISTS',
    message: 'Email already registered',
    userFriendlyMessage: 'An account with this email already exists. Please try signing in instead.'
  },
  
  USERNAME_ALREADY_EXISTS: {
    code: 'USERNAME_ALREADY_EXISTS',
    message: 'Username already taken',
    userFriendlyMessage: 'This username is already taken. Please choose a different one.'
  },
  
  // Password validation
  WEAK_PASSWORD: {
    code: 'WEAK_PASSWORD',
    message: 'Password does not meet requirements',
    userFriendlyMessage: 'Password must be at least 8 characters and include letters and numbers or symbols.'
  },
  
  // Network/Server errors
  NETWORK_ERROR: {
    code: 'NETWORK_ERROR',
    message: 'Network connection error',
    userFriendlyMessage: 'Unable to connect. Please check your internet connection and try again.'
  },
  
  // Generic fallback
  UNKNOWN_ERROR: {
    code: 'UNKNOWN_ERROR',
    message: 'An unexpected error occurred',
    userFriendlyMessage: 'Something went wrong. Please try again.'
  }
} as const;

/**
 * Maps Supabase authentication errors to user-friendly messages
 */
export function mapSupabaseAuthError(errorMessage?: string): string {
  if (!errorMessage || errorMessage.trim() === '') {
    return AUTH_ERRORS.UNKNOWN_ERROR.userFriendlyMessage;
  }
  
  const message = errorMessage.toLowerCase();
  
  // Credential errors - check multiple variations
  if (
    message.includes('invalid login credentials') || 
    message.includes('invalid credentials') ||
    message.includes('invalid email or password') ||
    message.includes('email or password is incorrect') ||
    message.includes('wrong password') ||
    message.includes('user not found') ||
    message.includes('no user found')
  ) {
    return AUTH_ERRORS.INVALID_CREDENTIALS.userFriendlyMessage;
  }
  
  // Email confirmation
  if (
    message.includes('email not confirmed') || 
    message.includes('confirmation') ||
    message.includes('email address not confirmed')
  ) {
    return AUTH_ERRORS.EMAIL_NOT_CONFIRMED.userFriendlyMessage;
  }
  
  // Rate limiting
  if (
    message.includes('too many requests') || 
    message.includes('rate limit') ||
    message.includes('too many attempts')
  ) {
    return AUTH_ERRORS.TOO_MANY_REQUESTS.userFriendlyMessage;
  }
  
  // Registration errors
  if (
    message.includes('already registered') || 
    message.includes('user already exists') ||
    message.includes('email already registered')
  ) {
    return AUTH_ERRORS.EMAIL_ALREADY_EXISTS.userFriendlyMessage;
  }
  
  // Password strength
  if (
    message.includes('password should be at least') || 
    message.includes('weak password') ||
    message.includes('password does not meet')
  ) {
    return AUTH_ERRORS.WEAK_PASSWORD.userFriendlyMessage;
  }
  
  // Network errors
  if (
    message.includes('network') || 
    message.includes('connection') || 
    message.includes('timeout') ||
    message.includes('failed to fetch') ||
    message.includes('networkerror')
  ) {
    return AUTH_ERRORS.NETWORK_ERROR.userFriendlyMessage;
  }
  
  // Supabase configuration errors
  if (
    message.includes('supabase client') ||
    message.includes('environment variables') ||
    message.includes('not properly configured')
  ) {
    return 'Configuration error. Please check your environment variables.';
  }
  
  // Default fallback - return the original message if it's meaningful, otherwise use generic
  // This helps with debugging while still providing user-friendly messages
  if (message.length < 50 && !message.includes('error') && !message.includes('exception')) {
    // If it's a short, meaningful message, return it (capitalize first letter)
    return errorMessage.charAt(0).toUpperCase() + errorMessage.slice(1);
  }
  
  return AUTH_ERRORS.UNKNOWN_ERROR.userFriendlyMessage;
}

/**
 * Maps Supabase database errors to user-friendly messages
 */
export function mapSupabaseDbError(errorMessage?: string): string {
  if (!errorMessage) return AUTH_ERRORS.UNKNOWN_ERROR.userFriendlyMessage;
  
  const message = errorMessage.toLowerCase();
  
  // Unique constraint violations
  if (message.includes('duplicate key') || message.includes('unique constraint')) {
    if (message.includes('username')) {
      return AUTH_ERRORS.USERNAME_ALREADY_EXISTS.userFriendlyMessage;
    }
    if (message.includes('email')) {
      return AUTH_ERRORS.EMAIL_ALREADY_EXISTS.userFriendlyMessage;
    }
  }
  
  // Foreign key violations
  if (message.includes('foreign key') || message.includes('referential integrity')) {
    return 'Invalid reference. Please try again.';
  }
  
  // Permission errors
  if (message.includes('permission') || message.includes('unauthorized')) {
    return 'You do not have permission to perform this action.';
  }
  
  // Default fallback
  return AUTH_ERRORS.UNKNOWN_ERROR.userFriendlyMessage;
}

/**
 * Validates password strength according to requirements
 */
export function validatePasswordStrength(password: string): {
  isValid: boolean;
  errors: string[];
  strength: 'weak' | 'medium' | 'strong';
} {
  const errors: string[] = [];
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (!/[A-Za-z]/.test(password)) {
    errors.push('Password must contain at least one letter');
  }
  
  if (!/\d/.test(password) && !/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one number or symbol');
  }
  
  const isValid = errors.length === 0;
  
  // Determine strength
  let strength: 'weak' | 'medium' | 'strong' = 'weak';
  if (isValid) {
    if (password.length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password)) {
      strength = 'strong';
    } else {
      strength = 'medium';
    }
  }
  
  return { isValid, errors, strength };
}

/**
 * Validates email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates username format (alphanumeric, underscores, hyphens, 3-20 chars)
 */
export function validateUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  if (username.length < 3) {
    return { isValid: false, error: 'Username must be at least 3 characters long' };
  }
  
  if (username.length > 20) {
    return { isValid: false, error: 'Username must be no more than 20 characters long' };
  }
  
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return { isValid: false, error: 'Username can only contain letters, numbers, underscores, and hyphens' };
  }
  
  return { isValid: true };
}
