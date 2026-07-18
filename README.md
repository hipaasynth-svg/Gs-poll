# Grateful Spaces Studio — the box

One page. One box. Create. The whole package renders in their browser.

Nothing is stored. The story exists as a variable inside one function invocation,
then the invocation ends.

## Deploy

```bash
npm i -g vercel
vercel login
vercel                              # first deploy, answer the prompts
vercel env add ANTHROPIC_API_KEY    # paste the key from console.anthropic.com
vercel env add SITE_PASSWORD        # the password that gates the site
vercel --prod
```

That's it. You get a URL. Send it — and the password — to whoever.

## The password gate

The site is behind one shared password so the URL alone can't spend your API
key. Set `SITE_PASSWORD` in Vercel (Settings → Environment Variables) and
redeploy. Visitors see a lock screen and must enter it before the box appears.

- The password is checked **server-side**: `api/create.js` refuses to run without
  a valid unlock cookie, so editing the page in the browser doesn't get past it.
- Unlocking sets an HttpOnly cookie for 30 days — enter it once per browser.
- Failed attempts are rate-limited per IP as a brute-force brake.
- Leave `SITE_PASSWORD` unset (e.g. local dev) and the gate is disabled — the
  site behaves exactly as before.

To change the password, update `SITE_PASSWORD` and redeploy; existing unlock
cookies stop working immediately.

## Files

```
public/index.html   the box + the rendered package + the lock screen
api/create.js       canon + Claude, returns pole + carve sheet, stores nothing
api/auth.js         checks the password, sets the unlock cookie
lib/auth.js         the gate: password check, cookie, server-side guard
lib/canon.js        canon.md as a JS string
vercel.json         60s function timeout, noindex
```

## When the canon changes

`lib/canon.js` is generated from `canon.md` in the parser repo:

```bash
python3 -c "
from pathlib import Path
c = Path('../grateful-spaces/canon.md').read_text()
e = c.replace('\\\\','\\\\\\\\').replace('\`','\\\\\`').replace('\${','\\\\\${')
Path('lib/canon.js').write_text('export const CANON = \`' + e + '\`;\n')
"
vercel --prod
```

## What they get

- the stack, crown to base
- what touches what
- the plaque
- uncut wood
- unmapped — beats the canon had no figure for
- both Midjourney prompts, copyable
- download: blueprint / carve sheet / plaque

The carve sheet is geometry only — no names, no derivation, no plaque. `toCarveSheet()`
strips it and `auditCarveSheet()` refuses to return anything that leaks. That's the file
they send you.

## Limits

- 5 poles per IP per hour, in-memory, resets when the lambda recycles
- story 200–20,000 characters
- your API key is on Vercel — anyone with the URL spends your money. Unlisted URL only.

## What you can say

**True:** nothing is stored. The studio works from geometry. The story passes through the
Anthropic API to be read and is never written to disk.

**Not true — don't say it:** "we never see your story" (the plaque is the story),
"complete privacy" (it's a third-party API call).
