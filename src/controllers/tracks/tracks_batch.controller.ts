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
      return res.status(400).json({ error: 'No IDs provided or invalid format' });
    }
    if (ids.length > 50) {
      return res.status(400).json({ error: 'Max 50 IDs allowed per request' });
    }
    
    // Validate each ID to prevent huge strings from consuming memory or crashing regex
    for (const id of ids) {
      if (typeof id !== 'string' || id.length > 50) {
        return res.status(400).json({ error: 'Invalid ID format in array' });
      }
    }

    const ytClient = await getYtMusicClient();

    const fetchSong = async (id: string) => {
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
    };

    // Concurrency pool implementation (max 5 active requests)
    const MAX_CONCURRENCY = 5;
    const result: Record<string, any> = {};
    const jobs = [...ids];
    
    async function worker() {
      while (jobs.length > 0) {
        const id = jobs.shift();
        if (!id) continue;
        try {
          const res = await fetchSong(id);
          if (res) {
            result[id] = res;
          }
        } catch (err) {
          console.error(`Batch worker error for ${id}:`, err);
        }
      }
    }

    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, ids.length) }, () => worker());
    await Promise.all(workers);

    return res.json({ data: result });
  } catch (error) {
    console.error('Batch fetch error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
