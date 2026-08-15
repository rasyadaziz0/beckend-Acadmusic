import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const SPOTIFY_TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Service-role client for writing Spotify tokens (never exposed to frontend)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export const getAuthSpotifyCallback = async (req: Request, res: Response) => {
  const code = req.query['code'] as string;
  const state = req.query['state'] as string;
  
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/spotify_oauth_state=([^;]+)/);
  const stateCookie = match ? match[1] : null;

  if (!code) {
    return res.status(400).json({ error: 'No code provided' });
  }

  if (!state || !stateCookie || state !== stateCookie) {
    return res.status(400).json({ error: 'Invalid OAuth state' });
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).json({ error: 'Spotify OAuth belum dikonfigurasi dengan benar.' });
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    // Use native fetch (Node 18+), no node-fetch needed
    const tokenResponse = await fetch(SPOTIFY_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const tokenData = await tokenResponse.json() as any;
    if (!tokenResponse.ok) {
      throw new Error(tokenData.error_description || 'Failed to exchange token');
    }

    // Extract user ID from the Supabase JWT in the Authorization header
    // The user must be logged in before initiating Spotify import
    const authHeader = req.headers.authorization;
    let userId: string | null = null;
    
    if (authHeader?.startsWith('Bearer ')) {
      // Decode JWT payload without verification (we just need the sub claim)
      const payload = JSON.parse(
        Buffer.from(authHeader.split(' ')[1].split('.')[1], 'base64url').toString()
      );
      userId = payload.sub;
    }

    // If we have a user ID, store Spotify tokens in Supabase (service-role, not accessible by frontend)
    if (userId) {
      await supabaseAdmin.from('user_spotify_tokens').upsert({
        user_id: userId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    }

    // Clear the OAuth state cookie
    res.cookie('spotify_oauth_state', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    // Support deep-linking back to RN app
    if (state.startsWith('rn_')) {
      return res.redirect(`acadmusic://import/spotify`);
    }
    
    return res.redirect(`${frontendUrl}/import/spotify`);
  } catch (error: unknown) {
    console.error('Spotify OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    
    if (state && state.startsWith('rn_')) {
      return res.redirect(`acadmusic://import/spotify?error=callback_failed`);
    }
    
    return res.redirect(`${frontendUrl}/import/spotify?error=callback_failed`);
  }
};

