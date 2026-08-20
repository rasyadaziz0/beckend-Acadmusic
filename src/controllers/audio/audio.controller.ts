import { Request, Response } from 'express';
import { getInnertube } from '../../lib/innertube';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Redis } from '@upstash/redis';
import youtubedl from 'youtube-dl-exec';

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? Redis.fromEnv()
  : null;

const GEMINI_KEY = process.env.GOOGLE_GEMINI_DISCOVER_KEY ?? '';

export const getAudioStream = async (req: Request, res: Response) => {
  const { videoId } = req.params;

  if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid videoId format' });
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const youtube = await getInnertube(attempt > 0);
      const info = await youtube.getInfo(videoId);

      const streamingData = info.streaming_data;
      let audioUrl: string | null = null;

      const audioFormats = streamingData?.adaptive_formats?.filter((f: any) => {
        const mime = f.mime_type || '';
        return f.has_audio && !f.has_video &&
          (mime.includes('audio/mp4') || mime.includes('audio/webm'));
      }).sort((a: any, b: any) => {
        const aMp4 = (a.mime_type || '').includes('audio/mp4');
        const bMp4 = (b.mime_type || '').includes('audio/mp4');
        if (aMp4 && !bMp4) return -1;
        if (!aMp4 && bMp4) return 1;
        return (b.average_bitrate || 0) - (a.average_bitrate || 0);
      }) ?? [];

      for (const format of audioFormats) {
        const url = format.url;
        if (url) {
          audioUrl = url;
          break;
        }
      }

      if (!audioUrl) {
        for (const format of audioFormats) {
          try {
            const url = await format.decipher(youtube.session.player);
            if (url) { audioUrl = url; break; }
          } catch {
            // Suppress decipher warning noise
          }
        }
      }

      // Fallback using youtube-dl-exec if youtubei.js failed
      if (!audioUrl) {
        try {
          const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;
          const output = await youtubedl(ytUrl, {
            dumpSingleJson: true,
            noWarnings: true,
            callHome: false,
            noCheckCertificates: true,
            youtubeSkipDashManifest: true,
            format: 'bestaudio/best'
          });
          const outAny = output as any;
          if (outAny && outAny.url) {
            audioUrl = outAny.url;
          }
        } catch (err) {
          console.error('youtube-dl-exec fallback failed:', err);
        }
      }

      if (!audioUrl) {
        if (attempt === 0) continue;
        return res.status(404).json({ error: 'No playable audio stream found' });
      }

      if (req.query.redirect === '1') {
        return res.redirect(audioUrl);
      }

      if (req.query.proxy === '1') {
        try {
          const { safeFetch } = require('../../lib/safeFetch');
          const proxyRes = await safeFetch(audioUrl, {
            maxRedirects: 3,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*'
            }
          });
          if (!proxyRes.ok) {
            return res.status(proxyRes.status).json({ error: 'Proxy failed to fetch stream' });
          }
          const contentType = proxyRes.headers.get('content-type') || 'audio/mp4';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'no-cache');
          res.status(proxyRes.status);
          if (proxyRes.body) {
            const { Readable } = require('stream');
            const nodeStream = Readable.fromWeb(proxyRes.body as any);
            nodeStream.pipe(res);
            req.on('close', () => nodeStream.destroy());
            return;
          } else {
            return res.send();
          }
        } catch (proxyErr) {
          console.error('Audio proxy stream error:', proxyErr);
          return res.status(500).json({ error: 'Failed to proxy audio stream' });
        }
      }

      return res.json({ url: audioUrl });

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (attempt === 0) continue;
      console.error('Audio proxy final error:', msg);
      return res.status(500).json({ error: 'Failed to resolve audio stream', detail: msg });
    }
  }
  return res.status(500).json({ error: 'Unexpected error' });
};

function mapYoutubeiToSong(item: any) {
  const videoId = item.id || item.video_id || item.videoId;
  if (!videoId) return null;

  const title = item.title?.text || item.title || 'Unknown Title';
  const authorName = item.author?.name || (typeof item.author === 'string' ? item.author : 'Unknown Artist');
  const thumbnail = item.thumbnail?.[0]?.url || item.thumbnails?.[0]?.url || '';

  let durationInSeconds = 0;
  const durStr = item.duration?.text || item.duration;
  if (typeof durStr === 'string') {
    const parts = durStr.split(':').map(Number);
    if (parts.length === 2) {
      durationInSeconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      durationInSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }

  return {
    id: videoId,
    name: title,
    type: 'song',
    year: '',
    releaseDate: null,
    duration: durationInSeconds,
    label: 'YouTube Music',
    explicitContent: false,
    playCount: 0,
    language: '',
    hasLyrics: false,
    lyricsId: null,
    url: `https://music.youtube.com/watch?v=${videoId}`,
    copyright: '',
    album: { id: `album-${videoId}`, name: 'Single', url: '' },
    artists: {
      primary: [{ id: `artist-${videoId}`, name: authorName, role: 'primary', type: 'artist', image: [], url: '' }],
      featured: [],
      all: [{ id: `artist-${videoId}`, name: authorName, role: 'primary', type: 'artist', image: [], url: '' }],
    },
    image: thumbnail ? [{ quality: '500x500', url: thumbnail }] : [],
    downloadUrl: [{ quality: '320kbps', url: `/api/audio/${videoId}` }],
  };
}

export const getRelatedAudio = async (req: Request, res: Response) => {
  const { videoId } = req.params;
  const title = (req.query.title as string) || '';
  const artist = (req.query.artist as string) || '';
  const userId = (req.query.userId as string) || 'anonymous';

  if (!videoId) return res.status(400).json({ error: 'Missing videoId' });

  const cacheKey = `related:v2:${videoId}`;
  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({ songs: cached, source: 'cache' });
    }
  }

  try {
    const youtube = await getInnertube();
    const upNext = await youtube.music.getUpNext(videoId);
    const contents = upNext?.contents;

    if (Array.isArray(contents) && contents.length > 0) {
      const songs = [];
      for (const item of contents) {
        if (item.type === 'PlaylistPanelVideo' || item.type === 'MusicResponsiveListItem') {
          const mapped = mapYoutubeiToSong(item);
          if (mapped) songs.push(mapped);
        }
      }

      if (songs.length > 0) {
        if (redis) await redis.setex(cacheKey, 86400, songs);
        return res.json({ songs, source: 'youtube' });
      }
    }

    if (!title || !artist) {
      return res.status(404).json({ error: 'YT Radio empty and no title/artist for Gemini fallback' });
    }

    const userGeminiKey = `gemini_cooldown:${userId}`;
    if (redis) {
      const inCooldown = await redis.get(userGeminiKey);
      if (inCooldown) {
        return res.status(429).json({ error: 'Gemini rate limited for this user' });
      }
      await redis.setex(userGeminiKey, 300, '1');
    }

    if (!GEMINI_KEY) throw new Error("No Gemini key");
    const genAI = new GoogleGenerativeAI(GEMINI_KEY);
    const model = genAI.getGenerativeModel({
      model: 'gemini-3.5-flash-lite',
      generationConfig: { responseMimeType: 'application/json' },
    });

    const safeTitle = title.replace(/[^a-zA-Z0-9\s\-'()]/g, '').slice(0, 100);
    const safeArtist = artist.replace(/[^a-zA-Z0-9\s\-'()]/g, '').slice(0, 100);
    const prompt = `Give me 10 similar songs to "${safeTitle}" by "${safeArtist}". Format as JSON array of objects with "title" and "artist".`;
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const suggestions = JSON.parse(text);

    const fallbackSongs = [];
    for (const item of suggestions) {
      if (!item.title || !item.artist) continue;
      try {
        const searchResults = await youtube.music.search(`${item.title} ${item.artist}`, { type: 'song' });
        const first = searchResults?.songs?.contents?.[0];
        if (first) {
          const mapped = mapYoutubeiToSong(first);
          if (mapped) fallbackSongs.push(mapped);
        }
      } catch (e) {
         // ignore
      }
    }

    if (fallbackSongs.length > 0) {
      if (redis) await redis.setex(cacheKey, 86400, fallbackSongs);
      return res.json({ songs: fallbackSongs, source: 'gemini' });
    }

    return res.status(404).json({ error: 'No related songs found via fallback' });

  } catch (error: unknown) {
    console.error('Related API error:', error);
    return res.status(500).json({ error: 'Failed to fetch related tracks' });
  }
};
