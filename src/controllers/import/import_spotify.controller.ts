import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const SPOTIFY_PLAYLIST_API_BASE = 'https://api.spotify.com/v1/playlists';

export const postImportSpotify = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return res.status(401).json({ error: 'Sesi lu nggak valid.' });
    }

    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(cookieHeader.split(';').map(c => c.trim().split('=')));
    const spotifyToken = cookies['spotify_token'];

    if (!spotifyToken) {
      return res.status(403).json({ error: 'Lu belum Connect Spotify!' });
    }

    const { url } = req.body;

    const match = url.match(/playlist\/([a-zA-Z0-9]+)/);
    if (!match) return res.status(400).json({ error: 'Link Spotify nggak valid' });

    const playlistId = match[1];
    const fetchRes = await fetch(`${SPOTIFY_PLAYLIST_API_BASE}/${playlistId}`, {
      headers: { Authorization: `Bearer ${spotifyToken}` },
    });

    if (!fetchRes.ok) {
      const errData = await fetchRes.json();
      throw new Error(errData.error?.message || 'Gagal narik playlist dari Spotify');
    }

    const data = await fetchRes.json();

    const tracks = data.tracks.items
      .filter((item: any) => item.track !== null) // Jaga-jaga ada lagu yang udah dihapus
      .map((item: any) => ({
        name: item.track.name,
        artist: item.track.artists[0].name,
        searchQuery: `${item.track.name} ${item.track.artists[0].name}`,
      }));

    return res.status(200).json({
      playlistName: data.name,
      tracks: tracks,
    });
  } catch (error: any) {
    console.error('Spotify import error:', error);
    return res.status(500).json({ error: 'Gagal narik data' });
  }
};
