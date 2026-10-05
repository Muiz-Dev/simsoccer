export type AuthResponse = {
  accessToken?: string;
  account?: {
    id: string;
    email: string;
    role: string;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    profileComplete: boolean;
    wallet: { balance: string; currency: string } | null;
  };
  challengeId?: string;
  purpose?: string;
  message?: string;
  error?: string;
  notificationSent?: boolean;
};

type AuthListener = (signedIn: boolean) => void;

let accessToken: string | null = null;
let accessTokenExpiresAt = 0;
let restorePromise: Promise<string | null> | null = null;
const listeners = new Set<AuthListener>();
const authChannel = typeof window === 'undefined' || typeof BroadcastChannel === 'undefined'
  ? null
  : new BroadcastChannel('simsoccer-auth');

authChannel?.addEventListener('message', (event: MessageEvent<{ type?: string; accessToken?: string }>) => {
  if (event.data?.type === 'token' && typeof event.data.accessToken === 'string') {
    accessToken = event.data.accessToken;
    accessTokenExpiresAt = Date.now() + 10 * 60 * 1000;
    publish();
  } else if (event.data?.type === 'signed-out') {
    accessToken = null;
    accessTokenExpiresAt = 0;
    publish();
  }
});

function publish(): void {
  const signedIn = Boolean(accessToken);
  listeners.forEach((listener) => listener(signedIn));
}

export function setAccessToken(value: string | null): void {
  accessToken = value;
  accessTokenExpiresAt = value ? Date.now() + 10 * 60 * 1000 : 0;
  publish();
  authChannel?.postMessage(value ? { type: 'token', accessToken: value } : { type: 'signed-out' });
}

export function subscribeAuth(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function restoreAccessToken(): Promise<string | null> {
  if (accessToken && accessTokenExpiresAt > Date.now() + 30_000) return accessToken;
  if (restorePromise) return restorePromise;
  if (accessToken) {
    accessToken = null;
    accessTokenExpiresAt = 0;
    publish();
  }
  const refresh = async () => {
    if (accessToken && accessTokenExpiresAt > Date.now() + 30_000) return accessToken;
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) {
        if (response.status !== 401) {
          throw new Error('Sign-in is temporarily unavailable. Try again.');
        }
        accessToken = null;
        accessTokenExpiresAt = 0;
        return null;
      }
      const result = await response.json() as AuthResponse;
      if (!result.accessToken) throw new Error("We couldn't sign you in. Try again.");
      setAccessToken(result.accessToken);
      return result.accessToken;
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error('Connection problem. Check your internet and try again.');
      }
      throw error;
    } finally {
      restorePromise = null;
      publish();
    }
  };
  restorePromise = (async () => {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request('simsoccer-session-refresh', refresh);
    }
    return refresh();
  })();
  return restorePromise;
}

export async function getAccessToken(): Promise<string | null> {
  return accessToken && accessTokenExpiresAt > Date.now() + 30_000
    ? accessToken
    : restoreAccessToken();
}

export async function requestAuth(path: string, body?: unknown, token?: string): Promise<AuthResponse> {
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`/api/auth/${path.replace(/^\/+/, '')}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Connection problem. Check your internet and try again.');
  }
  const result = await response.json().catch(() => null) as AuthResponse | null;
  if (!response.ok || !result) {
    if (response.status >= 500) {
      throw new Error("We couldn't complete that. Try again.");
    }
    throw new Error(result?.message ?? "We couldn't complete that. Try again.");
  }
  if (result.accessToken) setAccessToken(result.accessToken);
  return result;
}

export async function signOut(): Promise<void> {
  try {
    await requestAuth('logout');
  } finally {
    setAccessToken(null);
  }
}
