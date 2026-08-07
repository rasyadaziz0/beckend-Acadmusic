import { Router } from 'express';
import { getAudioStream, getRelatedAudio } from '../controllers/audio/audio.controller';
import { requireAuth } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimit';

import { getAudioResolve } from '../controllers/audio/audio_resolve.controller';

const router = Router();

// Rate limit: max 10 requests per minute
const resolveLimiter = rateLimiter({
  limit: 10,
  windowMs: 60 * 1000,
  keyPrefix: 'acadmusic:express:audio-resolve'
});

// Rate limit for public resolve: max 5 requests per minute
const publicResolveLimiter = rateLimiter({
  limit: 15, // Made it 15 to allow skipping songs on frontend
  windowMs: 60 * 1000,
  keyPrefix: 'acadmusic:express:public-resolve'
});

router.get('/resolve', publicResolveLimiter, getAudioResolve);
router.get('/:videoId', resolveLimiter, requireAuth, getAudioStream);
router.get('/related/:videoId', resolveLimiter, requireAuth, getRelatedAudio);

export default router;
