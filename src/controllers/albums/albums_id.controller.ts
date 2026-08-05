import { Request, Response } from 'express';
import { getITunesAlbum } from '../../lib/itunesApi';

export const getAlbumsId = async (req: Request, res: Response) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({ error: 'Missing album id' });
  }

  // Strip prefix if any
  const itunesId = id.replace(/^itunes-album-/, '');

  try {
    const album = await getITunesAlbum(itunesId);
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }
    return res.status(200).json({ data: album });
  } catch (error) {
    console.error('Album fetch failed:', error);
    return res.status(500).json({ error: 'Album fetch failed' });
  }
};
