import { createHmac, timingSafeEqual, randomBytes } from 'crypto';

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret(): string {
  return process.env.SESSION_SECRET || 'fallback-secret-do-not-use-in-production';
}

interface SessionPayload {
  exp: number;
}

export function createSessionToken(): string {
  const secret = getSecret();
  const payload: SessionPayload = { exp: Date.now() + SESSION_TTL };
  const data = JSON.stringify(payload);
  const encoded = Buffer.from(data).toString('base64');
  const hmac = createHmac('sha256', secret).update(encoded).digest('hex');
  return `${encoded}.${hmac}`;
}

export function verifySessionToken(token: string): boolean {
  const secret = getSecret();
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [encoded, signature] = parts;
  const expected = createHmac('sha256', secret).update(encoded).digest('hex');
  try {
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  } catch {
    return false;
  }
  const data = JSON.parse(Buffer.from(encoded, 'base64').toString('utf-8')) as SessionPayload;
  return data.exp > Date.now();
}

export function sessionCookie(token: string): string {
  return `ogc_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}`;
}

export function clearSessionCookie(): string {
  return `ogc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function getSessionToken(req: { headers: { cookie?: string } }): string | null {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/ogc_session=([^;]+)/);
  return match ? match[1] : null;
}

export function isAuthenticated(req: { headers: { cookie?: string } }): boolean {
  const token = getSessionToken(req);
  return token !== null && verifySessionToken(token);
}
