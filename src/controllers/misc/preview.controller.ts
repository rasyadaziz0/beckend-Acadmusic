import { Request, Response } from 'express';
import { getITunesPreviewUrl } from '../../lib/itunesApi';

export const getPreview = async (req: Request, res: Response) => {
const title = (req.query['title'] as string);
const artist = (req.query['artist'] as string) || '';

if (!title?.trim()) {
return res.status(400).json({ error: 'Missing title parameter' });
}

try {
const itunesPreview = await getITunesPreviewUrl(title.trim(), artist.trim());
if (itunesPreview) {
  return res.status(200).json({ previewUrl: itunesPreview, source: 'itunes' });
}

return res.json({ previewUrl: null, source: null });
} catch (error) {
console.error('Preview resolve failed:', error);
return res.json({ previewUrl: null, source: null });
}
};

