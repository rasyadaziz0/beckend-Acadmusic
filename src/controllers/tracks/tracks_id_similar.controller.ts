import { Request, Response } from 'express';
import { getITunesTrack } from '../../lib/itunesApi';
import { getYtMusicClient, mapUpNextToAppSong } from '../../lib/ytmusic';
import { Song } from '../../types/music';

export const dynamic = 'force-dynamic';

function isYouTubeVideoId(id: string): boolean {
  return /^[A-Za-z0-9_-]{11}$/.test(id);
}

export const getTracksIdSimilar = async (req: Request, res: Response) => {
const { id } = req.params;

if (!id) {
return res.status(400).json({ error: 'Invalid track id' });
}

try {
let videoId = id;

// If it's an iTunes ID, we need to resolve it to a YouTube videoId first
if (!isYouTubeVideoId(id)) {
  const itunesId = id.replace(/^itunes-/, '');
  const song = await getITunesTrack(itunesId);
  
  if (!song) {
    return res.status(404).json({ error: 'Track not found' });
  }

  const client = await getYtMusicClient();
  const query = `${song.name} ${song.artists.primary[0]?.name || ''}`.trim();
  
  // Search for the song on YT Music
  const searchResults = await client.searchSongs(query);
  if (!searchResults || searchResults.length === 0 || !searchResults[0].videoId) {
     return res.status(404).json({ error: 'Could not find similar tracks on YouTube Music' });
  }
  
  videoId = searchResults[0].videoId;
}

// Now we have a valid videoId, fetch UpNext / Similar Tracks
const client = await getYtMusicClient();
const upNexts = await client.getUpNexts(videoId);

if (!upNexts || upNexts.length === 0) {
  return res.status(500).json({ data: [] });
}

// Filter out non-song items and the original song itself, map to our Song interface
const mappedSongs: Song[] = upNexts
  .filter((item: any) => item.type === 'SONG' && item.videoId && item.videoId !== videoId)
  .map((item: any) => mapUpNextToAppSong(item))
  .filter((song: any): song is Song => song !== null);

return res.json({ data: mappedSongs });
} catch (error) {
console.error('Similar tracks fetch failed:', error);
return res.json({ error: 'Failed to fetch similar tracks' });
}
};

