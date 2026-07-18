import { isAuthed, gateEnabled, gateCookie, safeEqual } from '../lib/auth.js';

// Light in-memory brute-force brake. Resets when the lambda recycles — a speed
// bump, not a vault. It only counts failed attempts, so a legit user unlocking
// once is never affected.
const fails = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
}

function tooManyFails(ip) {
  const now = Date.now();
  const recent = (fails.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  fails.set(ip, recent);
  return recent.length >= MAX_FAILS;
}

function recordFail(ip) {
  const recent = fails.get(ip) || [];
  recent.push(Date.now());
  fails.set(ip, recent);
}

export default function handler(req, res) {
  // GET: report whether the gate is on and whether this browser is already in.
  if (req.method === 'GET') {
    return res.status(200).json({ required: gateEnabled(), authed: isAuthed(req) });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const password = process.env.SITE_PASSWORD;
  if (!password) {
    // Gate disabled — nothing to unlock.
    return res.status(200).json({ ok: true, required: false });
  }

  const ip = clientIp(req);
  if (tooManyFails(ip)) {
    return res
      .status(429)
      .json({ error: 'Too many attempts. Wait a few minutes and try again.' });
  }

  const submitted = req.body && req.body.password;
  if (typeof submitted !== 'string' || !safeEqual(submitted, password)) {
    recordFail(ip);
    return res.status(401).json({ error: 'Wrong password.' });
  }

  // Correct. Clear this IP's failure count and hand back the unlock cookie.
  fails.delete(ip);
  res.setHeader('Set-Cookie', gateCookie(password));
  return res.status(200).json({ ok: true });
}
