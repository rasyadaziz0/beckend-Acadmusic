import { Request, Response } from 'express';
import { safeFetch } from '../../lib/safeFetch';

export const getProxy = async (req: Request, res: Response) => {
  try {
    const imageUrl = req.query.url as string;

    if (!imageUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    // safeFetch validates DNS at connection time & follows up to 3 redirects safely
    const response = await safeFetch(imageUrl, { maxRedirects: 3 });

    if (!response.ok) {
      return res.status(400).json({ error: 'Failed to fetch image' });
    }

    const contentType = response.headers.get('content-type');
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    
    return res.status(200).send(buffer);
  } catch (error: any) {
    if (error?.message?.startsWith('SSRF blocked')) {
      return res.status(403).json({ error: 'Blocked: unsafe URL' });
    }
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

