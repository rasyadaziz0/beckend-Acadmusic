import { Request, Response, NextFunction } from 'express';
import { recordLatency } from '../services/metricsFlusher';

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - start) / 1_000_000;
    
    // Only record actual REST API requests (skip streaming proxies, assets, etc to keep latency metrics clean)
    if (!req.path.includes('/proxy') && !req.path.includes('/audio/') && !req.path.includes('/radio/')) {
      recordLatency(durationMs);
    }
  });

  next();
};
