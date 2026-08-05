import { Request, Response } from 'express';
import crypto from 'crypto';

const SPOTIFY_AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';

export const getAuthSpotifyLogin = async (req: Request, res: Response) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: 'Spotify OAuth belum dikonfigurasi dengan benar.' });
  }

  const state = crypto.randomBytes(16).toString('hex');
  const scope = 'playlist-read-private playlist-read-collaborative user-library-read';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope,
    redirect_uri: redirectUri,
    state,
  });

  res.cookie('spotify_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10 * 1000,
    path: '/',
  });

  return res.redirect(`${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`);
};
