# Environment Variables Setup Instructions

## Required Setup

To fix the login and registration pages, you need to create a `.env.local` file in the `expert_dashboard` directory with your Supabase credentials.

## Steps

1. **Create `.env.local` file** in the `expert_dashboard` directory (same level as `package.json`)

2. **Add the following content** to the file:

```env
NEXT_PUBLIC_SUPABASE_URL=https://dqbmrakpaxhqmfuwxuqf.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxYm1yYWtwYXhocW1mdXd4dXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTYzNTc4MTcsImV4cCI6MjA3MTkzMzgxN30.LZmk0N6uhUZ8Tr0T6mPd_J7phpvT5HXwQmoiYnjhKXQ
```

3. **Restart your development server** after creating the file:
   - Stop the current server (Ctrl+C)
   - Run `npm run dev` again

## For Vercel Deployment

When deploying to Vercel, add these environment variables in:
- Vercel Dashboard → Your Project → Settings → Environment Variables
- Add both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` with the same values

## Verification

After setting up the environment variables:
- The login page should now properly authenticate users
- The registration page should successfully create new accounts
- Error messages will be clear and user-friendly

