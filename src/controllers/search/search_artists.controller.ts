import { Request, Response } from 'express';
import { searchITunesArtists } from '../../lib/itunesApi';

export const getSearchArtists = async (req: Request, res: Response) => {
  const query = (req.query.q as string) || (req.query.query as string);
  const limit = parseInt(req.query.limit as string) || 20;
  const country = (req.query.country as string) || 'ID';

  if (!query?.trim()) {
    return res.status(400).json({ error: 'Query kosong.' });
  }

  try {
    const artists = await searchITunesArtists(query.trim(), limit, country);
    return res.json({ data: { results: artists } });
  } catch (error) {
    return res.status(500).json({ error: 'Gagal mencari artis' });
  }
};
