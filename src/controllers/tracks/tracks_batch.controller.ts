import { Request, Response } from 'express';
import { getITunesTrack } from '../../lib/itunesApi';
import { getYtMusicClient, mapYtSongToAppSong } from '../../lib/ytmusic';

function isYouTubeVideoId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

export const postTracksBatch = async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const ids = body.ids || [];
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No IDs provided' });
    }
    if (ids.length > 50) {
      return res.status(400).json({ error: 'Max 50 IDs allowed per request' });
    }

    const ytClient = await getYtMusicClient();

    const songs = await Promise.allSettled(ids.map(async (id: string) => {
      if (isYouTubeVideoId(id)) {
        try {
          const ytSong = await ytClient.getSong(id);
          return mapYtSongToAppSong(ytSong);
        } catch (err) {
          console.error(`YTMusic getSong error for ${id}:`, err);
          return null;
        }
      } else {
        return getITunesTrack(id);
      }
    }));

    const result: Record<string, any> = {};

    songs.forEach((promise, i) => {
      if (promise.status === 'fulfilled' && promise.value) {
        result[ids[i]] = promise.value;
      }
    });

    return res.json({ data: result });
  } catch (error) {
    console.error('Batch fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
