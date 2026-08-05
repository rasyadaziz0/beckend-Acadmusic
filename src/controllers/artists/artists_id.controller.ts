import { Request, Response } from 'express';
import { getITunesArtist, getITunesArtistAlbums } from '../../lib/itunesApi';

export const getArtistsId = async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ data: null });
  }

  if (id.startsWith('dz-') || id.startsWith('sp-')) {
    return res.status(404).json({ data: null, error: 'Legacy IDs are no longer supported. Please search again.' });
  }

  try {
    // Strip "itunes-artist-" prefix if present
    const itunesId = id.replace(/^itunes-artist-/, '');

    const [artist, albums] = await Promise.all([
      getITunesArtist(itunesId),
      getITunesArtistAlbums(itunesId, 5),
    ]);

    return res.status(200).json({
      data: {
        ...artist,
        nb_album: albums.length,
      },
    });
  } catch (error) {
    console.error('iTunes artist info failed:', error);
    return res.status(500).json({ data: null });
  }
};
