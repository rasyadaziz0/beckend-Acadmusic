import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import audioRoutes from './routes/audio.routes';
import apiRoutes from './routes/api.routes';

const app = express();
app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const PORT = process.env.PORT || 3001;

// CORS setup to allow Next.js frontend
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: function (origin, callback) {
    if (origin && allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());

// Main Routes
app.use('/api/audio', audioRoutes);
app.use('/api', apiRoutes);

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

// Setup Cron Job for Discover Weekly (Setiap Senin 00:00 di masing-masing zona waktu)
import cron from 'node-cron';

const timezoneToRegionMap: Record<string, string> = {
  'Asia/Jakarta': 'ID',
  'America/New_York': 'US',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Europe/London': 'GB',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Singapore': 'SG',
  'Asia/Bangkok': 'TH',
  'Asia/Manila': 'PH',
  'Australia/Sydney': 'AU',
  'America/Toronto': 'CA',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Rome': 'IT',
  'Europe/Madrid': 'ES',
  'America/Sao_Paulo': 'BR',
  'America/Mexico_City': 'MX',
  'Asia/Kolkata': 'IN'
};

Object.entries(timezoneToRegionMap).forEach(([tz, regionCode]) => {
  cron.schedule('0 0 * * 1', async () => {
    console.log(`[CRON] Running AI Discover Weekly for timezone: ${tz} (Region: ${regionCode})`);
    try {
      // Memanggil endpoint cron backend sendiri dengan parameter region
      const res = await fetch(`http://localhost:${PORT}/api/cron/discover?region=${regionCode}`, {
        headers: {
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
          'Origin': allowedOrigins[0] // Provide a valid origin for internal cron requests
        }
      });
      const data = await res.json();
      console.log(`[CRON ${tz}] Result:`, data);
    } catch (error) {
      console.error(`[CRON ${tz}] Failed to run Discover Weekly:`, error);
    }
  }, {
    timezone: tz
  });
});
