---
description: Generate demo videos with multi-voice dialogue instead of single-narrator voiceover. Use this skill whenever the user wants two or more voices in their demo video — including phrases like "dialogue between two people", "Q&A demo", "conversational demo", "host and guest", "interviewer and interviewee", "co-presenters", "two voices", "multiple narrators", "podcast-style demo", or any setup where different characters or roles speak different lines. Triggers especially on naming two or more speakers explicitly (e.g., "Arup explains and Neil asks questions"). For single-narrator demos, use the record skill instead.
---

# Demo Reel — Multi-Speaker

Generate demo videos where two or more voices speak — useful for Q&A demos, host-and-guest walkthroughs, co-presenter format, or any dialogue-driven content. Uses Gemini TTS's multi-speaker mode, which generates dialogue in a single API call (much better timing and natural turn-taking than concatenating separate single-voice clips).

Follows the same 6-phase workflow as the record skill, with a different scene schema.

## When to use this skill

- "Make a demo where Arup explains and Neil asks questions"
- "Generate a podcast-style walkthrough between two hosts"
- "I want a host-and-guest conversation about the new feature"
- "Two voices: one technical, one executive"

For single-narrator demos, use the **record** skill.

## How it differs from `record`

Same pipeline (record → narrate → merge → QA), same browser actions, same scenes.json file. The only difference is the **scene schema** for narration:

| Field | Single-speaker (record) | Multi-speaker (this skill) |
|-------|------------------------|---------------------------|
| Top-level `voice` | Single voice name | Omitted (per-speaker voices used) |
| Per-scene `narration` | A single string | Omitted |
| Per-scene `speakers` | — | Array of `{ name, voice }` |
| Per-scene `dialogue` | — | Array of `{ speaker, text }` |

A multi-speaker scene looks like:

```json
{
  "id": "intro",
  "speakers": [
    { "name": "Arup",  "voice": "Charon" },
    { "name": "Neil",  "voice": "Aoede" }
  ],
  "dialogue": [
    { "speaker": "Arup", "text": "Neil, you've been pressure-testing this with mid-market CFOs. What's landing?" },
    { "speaker": "Neil", "text": "What lands hardest is the 'always-on' part. They get it instantly when they see the alert before the report would have shown it." }
  ],
  "actions": [
    { "type": "goto", "url": "/dashboard" },
    { "type": "wait", "ms": 8000 }
  ]
}
```

You can mix single-speaker and multi-speaker scenes in the same demo — e.g., a solo intro, a dialogue middle, a solo close.

## The 6 phases

### Phase 1 — Discover

In addition to the standard discovery questions (start, end, duration, audience, key moments, tone), ask:

1. **How many speakers?** (typically 2)
2. **Names and roles?** (e.g., "Arup — host", "Neil — guest analyst")
3. **Voice for each?** (Gemini prebuilt voices — see voice table below; pair contrasting voices for clarity)
4. **Dialogue rhythm?** Roughly even back-and-forth, or one mostly explaining with the other prompting? Q&A format, or peer conversation?

If only one speaker is intended, redirect to the **record** skill.

### Phase 2 — Storyboard

Same format as record, but show dialogue lines with attribution. Each scene gets a short dialogue block instead of a single narration line:

```
Storyboard: <demo name>
Total target: <N>s   |   Estimated: <N>s
Speakers: Arup (Charon) — host, Neil (Aoede) — guest
Style: <one line>

Scene 1: intro   [~10s]
  Purpose:   Frame why this matters to mid-market CFOs
  Visual:    Goto / and wait
  Dialogue:
    Arup: Neil, you've been pressure-testing this with mid-market CFOs. What's landing?
    Neil: What lands hardest is the always-on part — they get it instantly when they see the alert before the report would have shown it.

Scene 2: ...
```

Ask: **"Does this dialogue work, or what should I tighten?"**

Wait for explicit approval. Dialogue is more sensitive to tone than monologue — a line that sounds fine in writing can sound stilted aloud. Encourage the user to read it out loud once before approving.

### Phase 3 — Generate scenes.json

Write `demo/scenes.json` using the multi-speaker schema. A complete example is at `templates/multi-speaker.example.json`. Show the file to the user before recording.

### Phase 4 — Execute

Same as record:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs demo/scenes.json
```

The `narrate.mjs` script auto-detects multi-speaker scenes (presence of `speakers` and `dialogue`) and routes them to Gemini's multi-speaker API. No flag needed.

### Phase 5 — QA

Standard QA runs automatically. For multi-speaker scenes, also listen for:

- **Voice confusion**: Gemini occasionally swaps voices on consecutive lines from the same speaker. If a line sounds like the wrong character, re-run with `--scene <id>` — the issue often doesn't recur.
- **Pacing**: Dialogue tends to be denser than monologue. If a scene feels rushed, add a `wait` action after it to give the audio time to breathe.
- **Tone mismatch**: If the chosen voice doesn't match the speaker's intended tone (e.g., a deep voice playing an excited line), the model may try to bridge the gap and sound off. Either pick a voice closer to the intended tone, or rewrite the line to fit the voice you chose.

### Phase 6 — Hand-off

Same as record. Mention which speakers were used in the summary:

```
✓ Multi-speaker demo ready for review

  File:      <path>
  Duration:  <N>s
  Scenes:    <N>  (<N> multi-speaker, <N> single-speaker)
  Speakers:  Arup (Charon), Neil (Aoede)
  ...
```

## Voice pairing tips

Pick voices that contrast clearly so listeners can track who's speaking:

| Pairing | Effect |
|---------|--------|
| `Charon` (deep) + `Aoede` (clear HD) | Authoritative host + articulate guest. Good for executive demos. |
| `Kore` (neutral pro) + `Puck` (upbeat) | Steady interviewer + energetic guest. Good for product demos. |
| `Enceladus` (breathy) + `Fenrir` (warm baritone) | Thoughtful + grounded. Good for contemplative pieces. |
| `Kore` + `Aoede` | Two professionals, distinguishable but not theatrical. Good for B2B. |

**Avoid**: two voices in the same register (e.g., both deep, both bright) — listeners will lose track of who's speaking. Always pair contrasting timbres.

## Style direction with multi-speaker

`globalStyle` at the top of scenes.json applies to the whole dialogue. Per-scene `style` overrides it. For multi-speaker, style direction is **shared across both voices in the scene** — Gemini's API doesn't currently support per-speaker style direction in a single call.

If you need very different styles per speaker, split the conversation into separate single-speaker scenes (one voice per scene) and let the visual sequence carry the "dialogue" feel.

Inline tags like `[pause]`, `[emphasis]`, `[laughs]` work inside dialogue text:

```json
{ "speaker": "Neil", "text": "[laughs] That's exactly what I told them. [pause] But here's the catch..." }
```

## Gotchas

- **Quote escaping**: dialogue text is JSON-quoted; use straight quotes, not curly. Apostrophes in contractions ("don't", "we're") are fine.
- **Same speaker, consecutive lines**: combine them into one line if possible. Gemini handles single longer lines per turn better than many short ones.
- **Don't use real public figures' voices**: stick to Gemini's prebuilt voice names. Don't ask the model to imitate a specific real person.

## Reference

- `${CLAUDE_PLUGIN_ROOT}/scripts/narrate.mjs` — handles multi-speaker via Gemini's `multiSpeakerVoiceConfig`
- `${CLAUDE_PLUGIN_ROOT}/scripts/pipeline.mjs` — orchestrator (no changes needed)
- `${CLAUDE_PLUGIN_ROOT}/templates/multi-speaker.example.json` — fully-worked dialogue example
