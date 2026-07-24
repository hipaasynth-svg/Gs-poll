# Forgotten-Issues Audit

**Generated:** 2026-07-21
**Method:** Walked the full commit history from the first commit (`8657afc`)
through the latest (`bd2da20`) — 18 commits — checking whether anything
introduced along the way was left half-finished, undone, or never cleaned up.

This is a small, tightly-scoped app and the history is clean: every commit
that describes a fix (non-JSON error surfacing, function timeouts, real xAI
error surfacing, search indexing) checks out against the current code, and
the two cleanup passes (copy rewrite, model swaps) left no dead UI paths or
stale env vars. One item stood out:

## `jsdom` is an unused dependency

**Where:** `package.json`, added in `5fa030f` ("Add story-pole Vercel app
(front-end, API, canon)") — the commit that introduced the whole app in its
current form.

`jsdom` has never been imported anywhere in `api/`, `lib/`, or `public/`
(confirmed via full-repo grep) in any of the 4 commits since it was added.
It's a real dependency Vercel will install on every deploy for no runtime
benefit — likely a leftover from an earlier approach to rendering or
scraping that didn't make it into the shipped version, with the
`package.json` entry never removed.

**Recommendation:** drop `jsdom` from `package.json` unless there's a
near-term plan that needs it.

No other forgotten issues found in this repo's history.
