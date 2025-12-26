# Tivoq Authentication Setup Guide

This guide explains how to configure Supabase authentication for the Tivoq app (Netlify/HTML).

## What's Been Implemented

✅ **Authentication Modal** - Sign up, sign in, and Google OAuth  
✅ **Cross-Subdomain Cookies** - Sessions persist across `.tivoq.com`  
✅ **Supabase Integration** - Full auth flow with PKCE  
✅ **Guest Mode** - Users can continue without signing in  
✅ **OAuth Callback Handler** - Netlify function for Google redirect  

---

## Environment Variables (Netlify)

Add these environment variables to your Netlify site settings:

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `SUPABASE_URL` | Your Supabase project URL | `https://yourproject.supabase.co` |
| `SUPABASE_ANON_KEY` | Your Supabase anon/public key | `eyJhbGciOiJIUzI1NiIs...` |

### Optional (Auth Cookie Configuration)

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_COOKIE_DOMAIN` | Cookie domain for cross-subdomain auth | `.tivoq.com` |
| `AUTH_SITE_URL` | Base URL for auth redirects | Auto-detected from request |
| `AUTH_REDIRECT_URL` | OAuth callback URL | `{AUTH_SITE_URL}/.netlify/functions/auth-callback` |

---

## Supabase Dashboard Configuration

### 1. Enable Google OAuth Provider

1. Go to **Authentication** → **Providers** in your Supabase dashboard
2. Enable **Google**
3. Add your Google OAuth credentials:
   - **Client ID**: From Google Cloud Console
   - **Client Secret**: From Google Cloud Console

### 2. Configure Redirect URLs

In **Authentication** → **URL Configuration**, add these redirect URLs:

```
https://tivoq.com/.netlify/functions/auth-callback
https://tivoq.com/
```

For local development, also add:
```
http://localhost:8888/.netlify/functions/auth-callback
http://localhost:8888/
```

### 3. Configure Site URL

Set the **Site URL** to your main domain:
```
https://tivoq.com
```

---

## Google Cloud Console Setup

### 1. Create OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project (or create one)
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. Select **Web application**

### 2. Configure Authorized Redirect URIs

Add these URIs:
```
https://yourproject.supabase.co/auth/v1/callback
```
(Replace `yourproject` with your actual Supabase project ID)

### 3. Configure Authorized JavaScript Origins

Add:
```
https://tivoq.com
https://www.tivoq.com
```

---

## Cross-Domain Cookie Configuration

The authentication system uses cookies with the `.tivoq.com` domain to allow users to stay logged in when navigating between subdomains (for example `tivoq.com` and `www.tivoq.com`).

### How It Works

1. When a user signs in, the session cookie is set with `domain=.tivoq.com`
2. This cookie is automatically sent to other `*.tivoq.com` subdomains
3. The Supabase client on both sites can read the same session

### Important Notes

- Both sites **must** use the same Supabase project
- Both sites **must** use the same cookie domain (`.tivoq.com`)
- Both sites should configure their Supabase client with the same storage settings

---

## Testing Locally

For local development, the cookie domain falls back to not setting a domain (works with `localhost`).

1. Run Netlify dev:
   ```bash
   npx netlify dev
   ```

2. Access the site at `http://localhost:8888`

3. Test the auth flow:
   - Sign up with email
   - Sign in with email
   - Sign in with Google
   - Continue as guest

---

## Auth Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    User visits site                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Check for existing Supabase session             │
│           (from cookies set on .tivoq.com domain)            │
└─────────────────────────────────────────────────────────────┘
                              │
               ┌──────────────┼──────────────┐
               │              │              │
               ▼              ▼              ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Session  │   │ URL Params│   │ No Auth  │
        │ Found    │   │ (userId) │   │ Found    │
        └──────────┘   └──────────┘   └──────────┘
               │              │              │
               ▼              ▼              ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ Use auth │   │ Use URL  │   │ Show     │
        │ session  │   │ params   │   │ Auth     │
        │          │   │          │   │ Modal    │
        └──────────┘   └──────────┘   └──────────┘
               │              │              │
               └──────────────┼──────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Initialize Video Chat                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Modified/Created

| File | Description |
|------|-------------|
| `index.html` | Added auth modal, Supabase auth logic, cross-domain cookies |
| `netlify/functions/client-config.js` | Added auth configuration options |
| `netlify/functions/auth-callback.js` | **NEW** - OAuth callback handler |
| `AUTH_SETUP.md` | **NEW** - This documentation |

---

## Troubleshooting

### "Supabase library not loaded"
- Check that the Supabase CDN script is loading correctly
- Verify network connectivity

### "Google sign in failed"
- Verify Google OAuth is enabled in Supabase dashboard
- Check redirect URLs are configured correctly
- Ensure Google Cloud Console credentials are correct

### Session not persisting across subdomains
- Verify `AUTH_COOKIE_DOMAIN` is set to `.tivoq.com`
- Ensure both sites use HTTPS (required for Secure cookies)
- Check browser dev tools → Application → Cookies to verify domain

### Users have to re-login when navigating
- Verify both sites use the same Supabase project
- Check that cookies are being set with the correct domain
- Ensure `SameSite` attribute is `Lax` or `None`

---

## Quick Checklist

- [ ] Set `SUPABASE_URL` in Netlify environment variables
- [ ] Set `SUPABASE_ANON_KEY` in Netlify environment variables
- [ ] Set `AUTH_COOKIE_DOMAIN` to `.tivoq.com` in Netlify
- [ ] Enable Google provider in Supabase dashboard
- [ ] Add redirect URLs in Supabase dashboard
- [ ] Configure Google Cloud Console OAuth credentials
- [ ] Deploy to Netlify
- [ ] Test sign up, sign in, and Google OAuth
