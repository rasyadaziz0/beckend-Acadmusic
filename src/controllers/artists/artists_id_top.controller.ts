import { Request, Response } from 'express';
import { getITunesArtistTopTracks } from '../../lib/itunesApi';

export const getArtistsIdTop = async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id) {
    return res.status(200).json({ data: { songs: [] } });
  }

  if (id.startsWith('dz-') || id.startsWith('sp-')) {
    return res.status(200).json({ data: { songs: [] } });
  }

  try {
    // Strip "itunes-artist-" prefix if present
    const itunesId = id.replace(/^itunes-artist-/, '');

    const songs = await getITunesArtistTopTracks(itunesId, 20);
    return res.status(200).json({ data: { songs } });
  } catch (error) {
    console.error('iTunes artist top tracks failed:', error);
    return res.status(500).json({ data: { songs: [] } });
  }
};
