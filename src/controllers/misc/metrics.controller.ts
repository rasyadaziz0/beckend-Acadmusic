import { Request, Response } from 'express';
import { supabase } from '../../lib/supabase/client';

export async function getMetrics(req: Request, res: Response): Promise<void> {
  try {
    const { range = 'day' } = req.query; // day, week, month

    let dateLimit = new Date();
    
    if (range === 'month') {
      dateLimit.setDate(dateLimit.getDate() - 30);
    } else if (range === 'week') {
      dateLimit.setDate(dateLimit.getDate() - 7);
    } else {
      dateLimit.setDate(dateLimit.getDate() - 1);
    }

    const { data, error } = await supabase
      .from('api_metrics')
      .select('timestamp, avg_latency_ms, max_latency_ms, request_count')
      .gte('timestamp', dateLimit.toISOString())
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('[Metrics API] Error fetching metrics:', error.message);
      res.status(500).json({ error: 'Failed to fetch metrics' });
      return;
    }

    res.json({ data });
  } catch (err: any) {
    console.error('[Metrics API] Exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}
