import { Request, Response } from 'express';

import { LyricsService } from '../../lib/LyricsService';

export const getLyrics = async (req: Request, res: Response) => {
  const title = (req.query.title as string) || '';
  const artist = (req.query.artist as string) || '';
  const album = (req.query.album as string) || '';
  const durationParam = req.query.duration as string;
  const durationSec = durationParam ? Number.parseInt(durationParam, 10) : null;

  // ── Delegate to service ──
  try {
    const service = LyricsService.getInstance();
    const result = await service.findLyrics({
      title,
      artist,
      album,
      durationSec,
    });

    if (!result) {
      return res.status(404).json({ error: 'Lirik gak ketemu' });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('Lyrics route error:', err);
    return res.status(500).json({ error: 'Gagal nyari lirik' });
  }
};
