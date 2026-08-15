import { Request, Response, NextFunction } from 'express';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitConfig = {
  limit: number;
  windowMs: number;
  keyPrefix?: string;
};

const store = new Map<string, Bucket>();

// Periodic cleanup every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of store.entries()) {
    if (now >= bucket.resetAt) {
      store.delete(key);
    }
  }
}, 10 * 60 * 1000).unref?.();

function checkLocalRateLimit(identifier: string, config: RateLimitConfig) {
  const actualLimit = process.env.NODE_ENV === 'development' ? config.limit * 10 : config.limit;
  const now = Date.now();
  const key = `${config.keyPrefix || 'api'}:${identifier}`;
  const existing = store.get(key);

  if (!existing || now >= existing.resetAt) {
    const resetAt = now + config.windowMs;
    store.set(key, { count: 1, resetAt });
    return {
      allowed: true,
      limit: actualLimit,
      remaining: Math.max(actualLimit - 1, 0),
      resetInSeconds: Math.ceil(config.windowMs / 1000),
    };
  }

  existing.count += 1;
  const remaining = Math.max(actualLimit - existing.count, 0);

  return {
    allowed: existing.count <= actualLimit,
    limit: actualLimit,
    remaining,
    resetInSeconds: Math.max(Math.ceil((existing.resetAt - now) / 1000), 1),
  };
}

const limiterCache = new Map<string, Ratelimit>();

function getRatelimiter(limit: number, windowMs: number, keyPrefix = 'api'): Ratelimit {
  const windowSeconds = Math.max(Math.ceil(windowMs / 1000), 1);
  const limiterKey = `${keyPrefix}:${limit}:${windowSeconds}`;

  if (limiterCache.has(limiterKey)) return limiterCache.get(limiterKey)!;

  const limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    analytics: true,
    prefix: `acadmusic:${keyPrefix}`,
  });

  limiterCache.set(limiterKey, limiter);
  return limiter;
}

export function rateLimiter(config: RateLimitConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Get IP or User ID
    const ip = req.ip || 'unknown';
    const userId = (req as any).user?.id;
    const baseId = userId || ip;

    const identifier = `${baseId}:${req.path}`;

    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const limiter = getRatelimiter(config.limit, config.windowMs, config.keyPrefix);
      const result = await limiter.limit(identifier);

      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      const resetInSeconds = Math.max(Math.ceil((result.reset - Date.now()) / 1000), 1);
      res.setHeader('X-RateLimit-Reset', resetInSeconds);

      if (!result.success) {
        res.setHeader('Retry-After', resetInSeconds);
        return res.status(429).json({ error: 'Too many requests' });
      }
      return next();
    }

    // Local fallback
    if (process.env.NODE_ENV === 'production') {
      console.warn('[RATE_LIMIT] WARNING: Upstash not configured. Using local in-memory rate limiting.');
    }

    const result = checkLocalRateLimit(identifier, config);
    res.setHeader('X-RateLimit-Limit', result.limit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', result.resetInSeconds);

    if (!result.allowed) {
      res.setHeader('Retry-After', result.resetInSeconds);
      return res.status(429).json({ error: 'Too many requests' });
    }

    next();
  };
}
