import { supabase } from '../lib/supabase/client';

let latencies: number[] = [];
let intervalId: NodeJS.Timeout | null = null;

export const recordLatency = (durationMs: number) => {
  latencies.push(durationMs);
};

export const startMetricsFlusher = () => {
  if (intervalId) return;

  // Flush every 60 seconds
  intervalId = setInterval(async () => {
    if (latencies.length === 0) return;

    // Swap buffers to allow concurrent requests while flushing
    const currentLatencies = latencies;
    latencies = [];

    const count = currentLatencies.length;
    const sum = currentLatencies.reduce((a, b) => a + b, 0);
    const avgLatency = Math.round(sum / count);
    const maxLatency = Math.round(Math.max(...currentLatencies));
    
    // Normalize to the current minute
    const timestamp = new Date();
    timestamp.setSeconds(0, 0);

    try {
      const { error } = await supabase
        .from('api_metrics')
        .insert({
          timestamp: timestamp.toISOString(),
          avg_latency_ms: avgLatency,
          max_latency_ms: maxLatency,
          request_count: count
        });

      if (error) {
        console.error('[MetricsFlusher] Error inserting metrics:', error.message);
      }
    } catch (err) {
      console.error('[MetricsFlusher] Exception inserting metrics:', err);
    }
  }, 60_000);
};

export const stopMetricsFlusher = () => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
};
