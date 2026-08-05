import { Request, Response } from 'express';
import { scrapePlaylist } from '../../lib/scrapers';

export const postImportScrape = async (req: Request, res: Response) => {
  try {
    const { url } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'URL tidak boleh kosong.' });
    }
    
    const playlist = await scrapePlaylist(url);
    return res.json({ success: true, data: playlist });
  } catch (error: any) {
    console.error('Scraping Error:', error);
    return res.status(500).json({ error: error.message || 'Gagal mengambil data dari URL.' });
  }
};
