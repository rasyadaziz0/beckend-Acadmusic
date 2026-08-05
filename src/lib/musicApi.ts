import { getITunesTrack, searchITunesTracks } from './itunesApi';
import { Song } from '../types/music';

export const searchSongs = (query: string, limit?: number, country?: string) => searchITunesTracks(query, limit, country);
export const getSongsByIds = async (trackIds: string[]): Promise<Song[]> => {
  if (trackIds.length === 0) return [];
  try {
    const songs = await Promise.allSettled(trackIds.map(id => getITunesTrack(id)));
    return songs
      .filter((s): s is PromiseFulfilledResult<Song> => s.status === 'fulfilled' && !!s.value)
      .map(s => s.value);
  } catch (error) {
    console.error('getSongsByIds error:', error);
    return [];
  }
};
