import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://zzmolktkgorerpaoglpr.supabase.co';
export const SUPABASE_ANON_KEY = 'REPLACE_WITH_YOUR_SUPABASE_ANON_KEY';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }
  return supabaseInstance;
}

export async function getSupabaseSession(): Promise<{
  accessToken: string;
  refreshToken: string;
  user?: { email?: string; id?: string };
} | null> {
  const sb = getSupabase();
  const { data, error } = await sb.auth.getSession();
  if (error || !data.session) {
    return null;
  }
  return {
    accessToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
    user: data.session.user
      ? {
          email: data.session.user.email || undefined,
          id: data.session.user.id,
        }
      : undefined,
  };
}
