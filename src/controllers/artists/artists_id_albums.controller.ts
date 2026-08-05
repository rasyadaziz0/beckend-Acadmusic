import { Request, Response } from 'express';
import { getITunesArtistAlbums } from '../../lib/itunesApi';

export const getArtistsIdAlbums = async (req: Request, res: Response) => {
  const { id } = req.params;
  const limitParam = req.query.limit as string;
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  if (!id || id.startsWith('dz-') || id.startsWith('sp-')) {
    return res.status(200).json({ data: [] });
  }

  try {
    // Strip "itunes-artist-" prefix if present
    const itunesId = id.replace(/^itunes-artist-/, '');

    const albums = await getITunesArtistAlbums(itunesId, limit);
    return res.status(200).json({ data: albums });
  } catch (error) {
    console.error('iTunes artist albums failed:', error);
    return res.status(500).json({ data: [] });
  }
};
