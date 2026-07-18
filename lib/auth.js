import crypto from 'crypto';

// One shared password gates the whole site. It lives in the SITE_PASSWORD
// environment variable on Vercel — never in the code. If it isn't set, the gate
// is disabled (so local dev and the very first deploy still work); set it in
// Vercel to turn the gate on.

const COOKIE_NAME = 'gs_gate';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

// The cookie token is derived from the password itself. Anyone who can compute
// this value already knows the password, so no separate signing secret is
// needed — knowing the token is equivalent to knowing the password.
export function tokenFor(password) {
  return crypto.createHash('sha256').update('gs-gate:' + password).digest('hex');
}

// Constant-time compare so we never leak length or content through timing.
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((pair) => {
    const i = pair.indexOf('=');
    if (i < 0) return;
    const k = pair.slice(0, i).trim();
    const v = pair.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

// True when the request may proceed. When no password is configured the gate is
// off and everything is allowed.
export function isAuthed(req) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return true;
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return false;
  return safeEqual(token, tokenFor(password));
}

// True when a password is configured, i.e. the gate is active.
export function gateEnabled() {
  return Boolean(process.env.SITE_PASSWORD);
}

// The Set-Cookie header value that unlocks the gate for this browser.
export function gateCookie(password) {
  const token = tokenFor(password);
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}
