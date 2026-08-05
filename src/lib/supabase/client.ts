import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    console.warn('Warning: Missing Supabase env variables');
    return createSupabaseClient('https://placeholder.supabase.co', 'placeholder');
  }

  return createSupabaseClient(supabaseUrl, supabaseKey);
}

export const supabase = createClient();
