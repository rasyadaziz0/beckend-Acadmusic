import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import audioRoutes from './routes/audio.routes';
import apiRoutes from './routes/api.routes';

const app = express();
app.set('trust proxy', 'loopback');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const PORT = process.env.PORT || 3001;

// CORS setup to allow Next.js frontend
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

// Health check doesn't need CORS (prevents Docker healthcheck from spamming CORS errors)
app.get('/health', (req, res) => {
  if (process.env.DEBUG_HEALTH === '1') {
    res.status(200).json({ 
      status: 'ok',
      ip: req.ip,
      xff: req.headers['x-forwarded-for'],
      cf: req.headers['cf-connecting-ip']
    });
  } else {
    res.status(200).json({ status: 'ok' });
  }
});

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Allow non-browser requests (SSR, Postman)
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));

// Main Routes
app.use('/api/audio', audioRoutes);
app.use('/api', apiRoutes);


// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Global Error]', err);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS policy violation' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});

// Setup Cron Jobs
import { CronScheduler } from './cron/CronScheduler';
CronScheduler.init(PORT, allowedOrigins);
