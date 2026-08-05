import { Request, Response } from 'express';
import { Readable } from 'stream';
import { safeFetch } from '../../lib/safeFetch';

export const getRadioProxy = async (req: Request, res: Response) => {
  const urlParam = req.query.url as string;
  
  if (!urlParam) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const proxyRes = await safeFetch(urlParam, {
      maxRedirects: 3,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
    });

    const contentType = proxyRes.headers.get('content-type') || 'audio/mpeg';
    const isM3U8 = contentType.includes('mpegurl') || urlParam.includes('.m3u8');

    if (isM3U8) {
      const text = await proxyRes.text();
      const baseUrl = new URL(urlParam);
      const lines = text.split('\n');
      const host = req.headers.host || 'localhost:3000';
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      
      const rewritten = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        
        let absoluteUrl = trimmed;
        if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
          absoluteUrl = new URL(trimmed, baseUrl).toString();
        }
        
        const proxyUrl = new URL(`${protocol}://${host}/api/radio/proxy`);
        proxyUrl.searchParams.set('url', absoluteUrl);
        return proxyUrl.toString();
      }).join('\n');
      
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      return res.status(proxyRes.status).send(rewritten);
    }

    // Stream audio — pipe directly to prevent OOM on infinite radio streams
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    
    res.status(proxyRes.status);
    
    if (proxyRes.body) {
      const nodeStream = Readable.fromWeb(proxyRes.body as any);
      nodeStream.pipe(res);
      
      // Cleanup if client disconnects
      req.on('close', () => {
        nodeStream.destroy();
      });
    } else {
      return res.send();
    }
  } catch (err: any) {
    if (err?.message?.startsWith('SSRF blocked')) {
      return res.status(403).send('Blocked: unsafe URL');
    }
    console.error('Radio proxy error:', err);
    return res.status(500).send('Proxy error');
  }
};

