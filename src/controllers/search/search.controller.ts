import { Request, Response } from 'express';
import { searchITunesTracks, searchITunesArtists } from '../../lib/itunesApi';

export const getSearch = async (req: Request, res: Response) => {
  const query = (req.query.q as string) || (req.query.query as string);

  if (!query?.trim()) {
    return res.status(400).json({ error: 'Query kosong.' });
  }

  try {
    const [songs, artists] = await Promise.all([
      searchITunesTracks(query.trim(), 15),
      searchITunesArtists(query.trim(), 5),
    ]);

    return res.json({
      data: {
        songs,
        artists,
      },
    });
  } catch (error) {
    console.error('iTunes combined search failed:', error);
    return res.status(500).json({ error: 'Gagal nyari' });
  }
};
