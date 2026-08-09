import { CANON } from '../lib/canon.js';
import { isAuthed } from '../lib/auth.js';

const MODEL = 'claude-sonnet-5';
const IMAGE_MODEL = 'grok-imagine-image-quality';   // xAI (Grok Imagine) renders the carving
// Cheaper alternative: 'grok-imagine-image' (~$0.02 vs ~$0.055 per image)
// Our own safety slice on the prompt we send to xAI — NOT xAI's documented cap
// (that isn't published). The prompt is engineered to fit well under this with
// the whole figure list up front, so this rarely bites; it's just a backstop
// against a runaway prompt. Raised to 2000 for headroom on very long lists.
const IMAGE_PROMPT_MAX = 2000;
const CAPACITY = { 6: 4, 8: 5, 10: 7, 12: 8 };

const MIN_STORY = 200;
const MAX_STORY = 20000;

// Light in-memory rate limit. Resets when the lambda recycles — that's fine,
// it's a speed bump for an unlisted URL, not a security boundary.
const hits = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;

// Render the carving with xAI (Grok). One image, best-effort: if the key is
// missing or the call fails, we still return the pole so the app keeps working.
// Only the geometry prompt is sent — no names, no story.
async function renderCarving(prompt) {
  const key = process.env.XAI_API_KEY;
  if (!key) return { image: null, image_error: 'no_key' };
  if (!prompt) return { image: null, image_error: 'no_prompt' };

  try {
    const r = await fetch('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: prompt.slice(0, IMAGE_PROMPT_MAX),
        n: 1,
        response_format: 'b64_json',
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('xai image error', r.status, detail.slice(0, 300));
      return { image: null, image_error: 'render_failed', image_detail: `xAI ${r.status}: ${detail.slice(0, 200)}` };
    }

    const data = await r.json();
    const b64 = data?.data?.[0]?.b64_json || null;
    if (!b64) return { image: null, image_error: 'no_image', image_detail: 'xAI returned no image data.' };
    return { image: `data:image/jpeg;base64,${b64}`, image_error: null, image_detail: null };
  } catch (e) {
    console.error('xai image exception', e.message);
    return { image: null, image_error: 'render_failed', image_detail: `request failed: ${e.message}` };
  }
}

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return true;
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

// The studio carving rules — the "cut minimums and relevant topics" — woven into every
// rendered figure.
const CRAFT = `a bold form carved in the round from the log — deep negative-space cuts, hard outline, radical simplification, symbol over anatomy; NOT relief, not a totem, not tribal or formline; no fur, feather, scale, pupil, or ornament detail; vertical wood grain, hard side lighting, deep shadows, neutral grey background`;

// The stable half of the prompt — canon + instructions. Identical on every
// request, so it caches. Story / height / budget live in the user message.
function buildSystem() {
  return `You are the parser for Grateful Spaces Studio. You take a person's life
story and render it into a story pole using the canon below. You never invent figures.
You only use what the canon contains.

<canon>
${CANON}
</canon>

The user message contains the pole height (in feet), the figure budget (number
of slots), and the person's life story. Read all three from there.

Do this work in order:

1. EXTRACT every beat in the story. A beat is a moment, not a biography entry. Tag each:
   {who, beat_type, intensity 0-1, when}. Use the beat_type vocabulary from the canon.
   Expect more beats than slots. That is correct.

2. Distinguish \`loss\` from \`removal\`. Loss is what they couldn't keep. Removal is what
   was taken from them by someone or something else. Removal resolves to THE EMPTY FORM.
   Do not force an Empty Form if the story has no removal. Many stories won't.

3. MAP beats to canon figures. Every figure must come from the canon's 20. If a beat has
   no home in the canon, mark it \`unmapped\` and keep it — do not silently drop it and do
   not invent a figure for it.

4. COMPRESS to the figure budget. Rank by intensity x narrative necessity. Minor beats
   collapse into bands or into the pose of a figure that's already present. A recurring
   person consolidates into ONE figure whose pose reflects their strongest beat. Only peak
   moments earn a slot. If the story genuinely will not compress, say so in
   \`overflow_note\` — that is a signal the story wants a taller pole, not a failure.

5. ARRANGE. Order is the timeline: base = origin, crown = present or aspiration. Set
   contact (gap/touch/interlock/reach) and direction (up/down/mutual/one-sided) between
   adjacent figures. Contact area scales intensity. Nothing ever reaches back from the
   Empty Form.

6. PLACE SUN and MOON if the story warrants. They are figures and consume slots. Sun =
   what was lived in the open. Moon = what happened in the dark, unwitnessed. Their
   absence is meaningful. Do not place them by default.

7. WRITE the plaque. Read the pole base to crown as prose. Plain, direct, unsentimental.
   Use the person's own facts. Do not soften and do not editorialize. This is the document
   that sells the pole and it is the part they will read out loud.

8. BUILD the render prompt by filling in the RENDER TEMPLATE below. Keep its fixed opening
   and closing sentences verbatim; fill in the numbered list. Wherever the template says
   [the total number of figures], replace it with the actual count of figures in the figures
   array (a single number). List every figure in strict order from the base (1) upward to the
   crown (N) — no omissions, no reordering. Every figure in the figures array is its own
   numbered line, named as the actual animal or form (a carved bear, a carved wolf, an owl,
   the empty form, the sun, ...), each with a short description of its pose, gaze, limbs, and
   mouth. The number of numbered lines must equal that count exactly. Figures and geometry
   only — never a person's name, relationship, or life event. Keep each numbered line to one
   concise clause and the whole prompt under ~1400 characters so nothing is cut off.

Return ONLY valid JSON. No markdown fences, no preamble.

{
  "height_ft": <pole height in feet, from the user message>,
  "figure_budget": <figure budget in slots, from the user message>,
  "figures": [
    {
      "slot": 1,
      "figure": "BEAR|WOLF|OWL|EAGLE|RAVEN|SALMON|RABBIT|DOG|TURTLE|LION|SLOTH|HORSE|RAM|FOX|SERPENT|CAT|DEER|PHOENIX|SUN|MOON|EMPTY_FORM",
      "pose": "",
      "gaze": "up|forward|down|turned",
      "limbs": "raised|crossed|extended|rest",
      "mouth": "open|closed|downturned",
      "sun_rays": null,
      "moon_phase": null,
      "moon_horns": null,
      "face": null,
      "represents": "",
      "beat_type": "",
      "derivation": "which words produced this figure and why it sits here",
      "plaque_line": ""
    }
  ],
  "adjacency": [
    {"from_slot": 1, "to_slot": 2, "contact": "gap|touch|interlock|reach", "direction": "up|down|mutual|one-sided", "meaning": ""}
  ],
  "bands": [
    {"between": [1, 2], "type": "", "meaning": ""}
  ],
  "unmapped": [
    {"text": "", "beat_type": "", "why_no_figure": ""}
  ],
  "overflow": [
    {"text": "", "why_cut": ""}
  ],
  "overflow_note": "",
  "uncut_wood": "what the pole leaves uncarved and why, or null",
  "plaque": "full prose, base to crown",
  "midjourney_prompt": "the filled render template — one prompt, base to crown, every figure a numbered line, under ~1400 chars"
}

RENDER TEMPLATE — return this filled in as "midjourney_prompt". Keep the opening and closing sentences verbatim; replace only the numbered list:

A photorealistic tall, freestanding western red cedar story pole [the pole height in feet, from the user message] feet tall, carved fully in the round as a three-dimensional sculpture (in the round, NOT a flat relief panel), standing vertically, entire pole visible base to crown, no cropping. It bears EXACTLY [the total number of figures] separate carved figures stacked one directly above another — render all [the total number of figures], each a distinct carving with clear wood between neighbours, none skipped, merged, or omitted.

From the base (1) up to the crown, in this exact order — one separate figure per line, no omissions and no reordering:
1. [base figure — named animal or form, with its pose]
2. [next figure — named animal or form, with its pose]
N. [crown figure — named animal or form, with its pose]

Each carving is ${CRAFT}. The wood shows natural variation in color and patina.

EXACTLY [the total number of figures] separate carved figures, one for every numbered line above — all carved and visible, none skipped or left out. Photorealistic, 8k, sharp focus, accurate proportions, full vertical composition, no cropping.
`;
}

// The volatile half — the only part that changes per request.
function buildUser(story, height, budget) {
  return `Pole height: ${height} feet.
Figure budget: ${budget} slots.

<story>
${story}
</story>`;
}

// Image models drop figures on tall, busy poles. Don't trust the parser to
// phrase the count right — guarantee it. Fill any leftover [the total number of
// figures] placeholder with the real count, and if the exact count still isn't
// stated up front, lead with it so it's read first and survives truncation.
export function enforceFigureCount(prompt, n) {
  if (!prompt || !n) return prompt || '';
  let out = prompt.split('[the total number of figures]').join(String(n));
  if (!out.slice(0, 140).includes(String(n))) {
    out = `A carved story pole bearing EXACTLY ${n} separate figures stacked base to crown — render all ${n}, none skipped, merged, or omitted. ${out}`;
  }
  return out;
}

// Geometry only. No names, no derivation, no plaque. This is the studio copy.
const GEOMETRY_FIELDS = [
  'slot', 'figure', 'pose', 'gaze', 'limbs', 'mouth',
  'sun_rays', 'moon_phase', 'moon_horns', 'face',
];
const IDENTIFYING = ['represents', 'derivation', 'plaque_line', 'beat_type', 'plaque', 'beats'];

export function toCarveSheet(pole) {
  const figures = [...pole.figures]
    .sort((a, b) => a.slot - b.slot)
    .map((f) => {
      const out = {};
      for (const k of GEOMETRY_FIELDS) {
        if (f[k] !== null && f[k] !== undefined) out[k] = f[k];
      }
      return out;
    });

  return {
    height_ft: pole.height_ft,
    figures,
    adjacency: (pole.adjacency || []).map((a) => ({
      from_slot: a.from_slot,
      to_slot: a.to_slot,
      contact: a.contact,
      direction: a.direction,
    })),
    bands: (pole.bands || []).map((b) => ({ between: b.between, type: b.type })),
    uncut_wood_above_crown: Boolean(pole.uncut_wood),
    midjourney_prompt: pole.midjourney_prompt || '',
    _note: 'Geometry only. No story, no names, no derivation. Carve what this shows.',
  };
}

export function auditCarveSheet(carve) {
  const blob = JSON.stringify(carve);
  return IDENTIFYING.filter((f) => blob.includes(`"${f}"`));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  // The gate. Without a valid unlock cookie the parser never runs, so the URL
  // alone can't spend the API key. No-op when SITE_PASSWORD isn't configured.
  if (!isAuthed(req)) {
    return res.status(401).json({ error: 'locked' });
  }

  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    return res
      .status(429)
      .json({ error: 'Too many poles from this address. Try again in an hour.' });
  }

  const { story, height = 12 } = req.body || {};

  if (typeof story !== 'string' || story.trim().length < MIN_STORY) {
    return res
      .status(400)
      .json({ error: `Tell it longer. At least ${MIN_STORY} characters.` });
  }
  if (story.length > MAX_STORY) {
    return res
      .status(400)
      .json({ error: `That's over ${MAX_STORY} characters. Trim it.` });
  }

  const budget = CAPACITY[height];
  if (!budget) {
    return res.status(400).json({ error: 'Height must be 6, 8, 10, or 12.' });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'Server is missing its API key.' });
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: 'disabled' },
        // Canon + instructions are identical every call, so cache them.
        system: [
          { type: 'text', text: buildSystem(), cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          { role: 'user', content: buildUser(story.trim(), height, budget) },
        ],
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('anthropic error', r.status, detail.slice(0, 300));
      return res.status(502).json({ error: 'The parser failed. Try again.' });
    }

    const data = await r.json();
    let raw = data.content[0].text.trim();

    if (raw.startsWith('```')) {
      raw = raw.split('```')[1];
      if (raw.startsWith('json')) raw = raw.slice(4);
      raw = raw.trim();
    }

    let pole;
    try {
      pole = JSON.parse(raw);
    } catch {
      // Never log the raw output — it contains the story.
      return res
        .status(502)
        .json({ error: 'The parser returned something malformed. Try again.' });
    }

    // Lock the exact figure count into the render prompt before it's rendered,
    // shown, or copied — so the carve sheet, the on-page prompt, and the image
    // all agree, and the renderer stops dropping figures.
    if (pole && Array.isArray(pole.figures)) {
      pole.midjourney_prompt = enforceFigureCount(pole.midjourney_prompt, pole.figures.length);
    }

    const carve = toCarveSheet(pole);
    const leaks = auditCarveSheet(carve);
    if (leaks.length) {
      console.error('carve sheet leak:', leaks);
      return res.status(500).json({ error: 'Refusing to return a leaky carve sheet.' });
    }

    // Render the carving once with Grok (best-effort; geometry prompt only).
    const rendered = await renderCarving(pole.midjourney_prompt);

    // The story dies here. It was a variable in this invocation. Nothing is stored.
    return res.status(200).json({
      pole,
      carve,
      image: rendered.image,
      image_error: rendered.image_error,
      image_detail: rendered.image_detail || null,
    });
  } catch (e) {
    console.error('handler error', e.message);
    return res.status(500).json({ error: 'Something broke. Try again.' });
  }
}
