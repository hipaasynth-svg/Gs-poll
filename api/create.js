import { CANON } from '../lib/canon.js';

const MODEL = 'claude-opus-4-8';
const IMAGE_MODEL = 'grok-imagine-image-quality';   // xAI (Grok Imagine) renders the carving
// Cheaper alternative: 'grok-imagine-image' (~$0.02 vs ~$0.055 per image)
const IMAGE_PROMPT_MAX = 1024;        // xAI image prompt length cap
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
      console.error('xai image error', r.status, detail.slice(0, 200));
      return { image: null, image_error: 'render_failed' };
    }

    const data = await r.json();
    const b64 = data?.data?.[0]?.b64_json || null;
    if (!b64) return { image: null, image_error: 'no_image' };
    return { image: `data:image/jpeg;base64,${b64}`, image_error: null };
  } catch (e) {
    console.error('xai image exception', e.message);
    return { image: null, image_error: 'render_failed' };
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

const STYLE_BLOCK = `STYLE: Radical simplification. Flat carved planes, fewer than 12 cuts per figure. Hard
outline only. NO fur texture, NO feather detail, NO rendered pupils, NO scales, NO
ornamental borders, NO geometric flourishes, NO mask forms. Symbol over anatomy. Negative
space does half the work. Medieval hermetic woodcut, not tribal, not formline. Vertical
wood grain visible through every figure. Dramatic side lighting, hard shadows, neutral
concrete background.
--no fur, feathers, texture, ornament, filigree, tribal mask, formline, totem`;

function buildPrompt(story, height, budget) {
  return `You are the parser for Grateful Spaces Studio. You take a person's life
story and render it into a story pole using the canon below. You never invent figures.
You only use what the canon contains.

<canon>
${CANON}
</canon>

<story>
${story}
</story>

The pole is ${height} feet. Figure budget: ${budget} slots.

Do this work in order:

1. EXTRACT every beat in the story. A beat is a moment, not a biography entry. Tag each:
   {who, beat_type, intensity 0-1, when}. Use the beat_type vocabulary from the canon.
   Expect more beats than slots. That is correct.

2. Distinguish \`loss\` from \`removal\`. Loss is what they couldn't keep. Removal is what
   was taken from them by someone or something else. Removal resolves to THE EMPTY FORM.
   Do not force an Empty Form if the story has no removal. Many stories won't.

3. MAP beats to canon figures. Every figure must come from the canon's 16. If a beat has
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

8. BUILD one Midjourney prompt for the whole pole, base to crown, following the style block
   at the end of this message exactly. Number every figure explicitly (ELEMENT 1 at the base,
   then ELEMENT 2 directly above it, continuing to the crown) — the model does not respect
   unnumbered sequence. For each element, NAME the actual animal or form (a carved bear, a
   carved wolf, an owl, a raven, and so on) so no figure is ever dropped from the render, then
   give its geometry: pose, gaze, limbs, mouth, and any sun/moon detail. Every figure in the
   list above must appear as its own named element — never omit an animal. Describe the named
   figures and their GEOMETRY ONLY. Never put a person's name, relationship, or life event
   into the prompt.

Return ONLY valid JSON. No markdown fences, no preamble.

{
  "height_ft": ${height},
  "figure_budget": ${budget},
  "figures": [
    {
      "slot": 1,
      "figure": "BEAR|WOLF|OWL|EAGLE|RAVEN|SALMON|RABBIT|DOG|TURTLE|LION|SLOTH|HORSE|RAM|PHOENIX|SUN|MOON|EMPTY_FORM",
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
  "midjourney_prompt": "one full prompt, base to crown, every figure named as its own element, ending with the style block"
}

STYLE BLOCK — the Midjourney prompt must end with exactly this:

${STYLE_BLOCK}
`;
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
        messages: [
          { role: 'user', content: buildPrompt(story.trim(), height, budget) },
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

    const carve = toCarveSheet(pole);
    const leaks = auditCarveSheet(carve);
    if (leaks.length) {
      console.error('carve sheet leak:', leaks);
      return res.status(500).json({ error: 'Refusing to return a leaky carve sheet.' });
    }

    // Render the carving once with Grok (best-effort; geometry prompt only).
    const { image, image_error } = await renderCarving(pole.midjourney_prompt);

    // The story dies here. It was a variable in this invocation. Nothing is stored.
    return res.status(200).json({ pole, carve, image, image_error });
  } catch (e) {
    console.error('handler error', e.message);
    return res.status(500).json({ error: 'Something broke. Try again.' });
  }
}
