function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }

  const metaEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  if (typeof import.meta !== 'undefined' && metaEnv) {
    return metaEnv?.[key];
  }

  return undefined;
}

export const SUPABASE_URL = readEnv('SUPABASE_URL') ?? '';
export const SUPABASE_ANON_KEY = readEnv('SUPABASE_ANON_KEY') ?? '';

function ensureSupabaseConfigured(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('supabase_not_configured');
  }
}

interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  user?: {
    id: string;
    email?: string;
  };
  expires_at?: number;
}

interface SupabaseAuthError {
  message: string;
  status?: number;
}

let currentSession: SupabaseSession | null = null;

export function setSupabaseSession(session: SupabaseSession | null): void {
  currentSession = session;
}

export function getSupabaseSession(): SupabaseSession | null {
  return currentSession;
}

function authHeaders(): Record<string, string> {
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
  };
}

function authHeadersWithToken(accessToken: string): Record<string, string> {
  return {
    ...authHeaders(),
    'Authorization': `Bearer ${accessToken}`,
  };
}

export async function signInWithPassword(email: string, password: string): Promise<{ session?: SupabaseSession; user?: SupabaseSession['user']; error?: SupabaseAuthError }> {
  try {
    ensureSupabaseConfigured();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: { message: data.error_description || data.msg || data.message || 'login_failed', status: res.status } };
    }
    currentSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user ? { id: data.user.id, email: data.user.email } : undefined,
      expires_at: data.expires_at,
    };
    return { session: currentSession, user: currentSession.user };
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'network_error' } };
  }
}

export async function signUp(email: string, password: string): Promise<{ session?: SupabaseSession; user?: SupabaseSession['user']; error?: SupabaseAuthError; needsEmailConfirmation?: boolean }> {
  try {
    ensureSupabaseConfigured();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: { message: data.error_description || data.msg || data.message || 'signup_failed', status: res.status } };
    }
    if (data.code === 200 && !data.session) {
      return { user: data.user ? { id: data.user.id, email: data.user.email } : undefined, needsEmailConfirmation: true };
    }
    if (data.session) {
      currentSession = {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: data.session.user ? { id: data.session.user.id, email: data.session.user.email } : undefined,
        expires_at: data.session.expires_at,
      };
      return { session: currentSession, user: currentSession.user };
    }
    return { user: data.user ? { id: data.user.id, email: data.user.email } : undefined };
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'network_error' } };
  }
}

export async function refreshSession(refreshToken: string): Promise<{ session?: SupabaseSession; error?: SupabaseAuthError }> {
  try {
    ensureSupabaseConfigured();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: { message: data.error_description || data.msg || data.message || 'refresh_failed', status: res.status } };
    }
    currentSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user: data.user ? { id: data.user.id, email: data.user.email } : undefined,
      expires_at: data.expires_at,
    };
    return { session: currentSession };
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'network_error' } };
  }
}

export async function signOut(accessToken: string): Promise<{ error?: SupabaseAuthError }> {
  try {
    ensureSupabaseConfigured();
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: authHeadersWithToken(accessToken),
    });
    currentSession = null;
    return {};
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'network_error' } };
  }
}

export async function getUser(accessToken: string): Promise<{ user?: SupabaseSession['user']; error?: SupabaseAuthError }> {
  try {
    ensureSupabaseConfigured();
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      method: 'GET',
      headers: authHeadersWithToken(accessToken),
    });
    const data = await res.json();
    if (!res.ok) {
      return { error: { message: data.error_description || data.msg || data.message || 'get_user_failed', status: res.status } };
    }
    return { user: { id: data.id, email: data.email } };
  } catch (err) {
    return { error: { message: err instanceof Error ? err.message : 'network_error' } };
  }
}
