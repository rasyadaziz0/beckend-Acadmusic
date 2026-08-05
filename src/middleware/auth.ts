import { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!supabaseUrl) {
  console.error('FATAL: NEXT_PUBLIC_SUPABASE_URL is missing. Please set it in .env');
  process.exit(1);
}

const JWKS = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));

export interface AuthenticatedRequest extends Request {
  user?: any;
}

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const token = authHeader.split(' ')[1];
    
    const { payload } = await jwtVerify(token, JWKS, { 
      audience: 'authenticated', 
      issuer: `${supabaseUrl}/auth/v1` 
    });

    // Provide a compatible user object
    req.user = { ...payload, id: payload.sub };
    
    next();
  } catch (err: any) {
    if (err?.code === 'ERR_JWKS_TIMEOUT' || err?.code === 'ERR_JWKS_MULTIPLE_MATCHING_KEYS') {
      return res.status(503).json({ error: 'Auth temporarily unavailable' });
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
