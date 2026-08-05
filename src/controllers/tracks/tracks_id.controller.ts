import { Request, Response } from 'express';
import { getITunesTrack } from '../../lib/itunesApi';
import { getYtMusicClient, mapYtSongToAppSong } from '../../lib/ytmusic';


function isYouTubeVideoId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

export const getTracksId = async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: 'ID is required' });
  }

  try {
    let song = null;
    
    if (isYouTubeVideoId(id)) {
      const ytClient = await getYtMusicClient();
      const ytSong = await ytClient.getSong(id);
      song = mapYtSongToAppSong(ytSong);
    } else {
      song = await getITunesTrack(id);
    }

    if (!song) {
      return res.status(404).json({ error: 'Song not found' });
    }
    return res.json({ data: song });
  } catch (error) {
    console.error('Error fetching song:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
