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
          throw new Error('Account services are temporarily unavailable.');
        }
        accessToken = null;
        accessTokenExpiresAt = 0;
        return null;
      }
      const result = await response.json() as AuthResponse;
      if (!result.accessToken) throw new Error('Account services returned an invalid session.');
      setAccessToken(result.accessToken);
      return result.accessToken;
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
  const response = await fetch(`/api/auth/${path.replace(/^\/+/, '')}`, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => null) as AuthResponse | null;
  if (!response.ok || !result) {
    throw new Error(result?.message ?? 'Account services are temporarily unavailable. Try again.');
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
