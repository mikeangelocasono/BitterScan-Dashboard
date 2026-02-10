import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';

/**
 * POST /api/auth/register
 * 
 * Server-side registration endpoint that uses admin privileges to create user and profile.
 * This bypasses RLS policies and ensures profile creation succeeds.
 * 
 * Expected body:
 * {
 *   email: string,
 *   password: string,
 *   username: string,
 *   fullName: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, username, fullName } = body;

    // Validate required fields
    if (!email || !password || !username || !fullName) {
      return NextResponse.json(
        { 
          error: 'Missing required fields',
          details: 'Email, password, username, and full name are required.'
        },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Validate password strength (at least 8 characters)
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    // Get admin client (bypasses RLS)
    const supabase = getSupabaseAdminClient();

    // Check if email already exists
    const { data: existingUserByEmail, error: emailCheckError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email.trim().toLowerCase())
      .single();

    if (existingUserByEmail) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Check if username already exists
    const { data: existingUserByUsername, error: usernameCheckError } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username.trim())
      .single();

    if (existingUserByUsername) {
      return NextResponse.json(
        { error: 'This username is already taken' },
        { status: 409 }
      );
    }

    // Create user with Supabase Auth (admin client)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: password,
      email_confirm: true, // Auto-confirm email for experts (no email confirmation needed)
      user_metadata: {
        full_name: fullName.trim(),
        username: username.trim(),
        role: 'expert',
      }
    });

    if (authError) {
      console.error('[Register API] Auth error:', authError);
      
      // Handle specific auth errors
      if (authError.message?.toLowerCase().includes('already registered') || 
          authError.message?.toLowerCase().includes('user already exists')) {
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 }
        );
      }
      
      return NextResponse.json(
        { 
          error: authError.message || 'Failed to create user account',
          details: authError
        },
        { status: 500 }
      );
    }

    if (!authData?.user) {
      return NextResponse.json(
        { error: 'Failed to create user account - no user data returned' },
        { status: 500 }
      );
    }

    // Create profile in database (admin client bypasses RLS)
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id,
        username: username.trim(),
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        role: 'expert',
        status: 'pending', // Experts require admin approval
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

    if (profileError) {
      console.error('[Register API] Profile creation error:', profileError);
      
      // If profile creation fails, delete the auth user to maintain consistency
      await supabase.auth.admin.deleteUser(authData.user.id);
      
      // Handle specific database errors
      if (profileError.message?.includes('duplicate key') || 
          profileError.message?.includes('unique constraint')) {
        if (profileError.message?.includes('username')) {
          return NextResponse.json(
            { error: 'This username is already taken' },
            { status: 409 }
          );
        }
        if (profileError.message?.includes('email')) {
          return NextResponse.json(
            { error: 'An account with this email already exists' },
            { status: 409 }
          );
        }
      }
      
      return NextResponse.json(
        { 
          error: 'Failed to create user profile',
          details: profileError.message
        },
        { status: 500 }
      );
    }

    // Success - return user data
    return NextResponse.json(
      { 
        success: true,
        message: 'Registration successful! Please wait for admin approval before logging in.',
        user: {
          id: authData.user.id,
          email: authData.user.email,
          username: username.trim(),
          role: 'expert',
          status: 'pending'
        }
      },
      { status: 201 }
    );

  } catch (error: any) {
    console.error('[Register API] Unexpected error:', error);
    
    // Provide more detailed error message in development
    const errorDetails = process.env.NODE_ENV === 'development' 
      ? { details: error?.message || String(error), stack: error?.stack }
      : {};
    
    return NextResponse.json(
      { 
        error: 'An unexpected error occurred during registration',
        ...errorDetails
      },
      { status: 500 }
    );
  }
}
