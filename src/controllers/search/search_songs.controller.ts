import { Request, Response } from 'express';
import { searchITunesTracks } from '../../lib/itunesApi';

export const getSearchSongs = async (req: Request, res: Response) => {
  const query = (req.query.q as string) || (req.query.query as string);
  const limit = parseInt(req.query.limit as string) || 20;
  const country = (req.query.country as string) || 'ID';

  if (!query?.trim()) {
    return res.status(400).json({ error: 'Query kosong.' });
  }

  try {
    const songs = await searchITunesTracks(query.trim(), limit, country);
    return res.json({ data: { results: songs } });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mencari lagu' });
  }
};
