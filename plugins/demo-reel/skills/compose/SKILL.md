---
description: Add polish to an existing demo video — intro and outro cards, lower-third text overlays, and background music with sidechain ducking under narration. Use this skill whenever the user wants to add a title card, intro screen, outro screen, ending screen, end card, call-to-action card, captions, lower-thirds, text overlays, label overlays, background music, soundtrack, or audio bed to a video they already have (typically the output of the record skill). Also triggers on phrases like "polish this demo", "add a title screen", "put music behind it", "add captions at these timestamps", "brand this video", or "make this look more produced". Do not use for recording or narration — use the record skill for that.
---

# Demo Reel — Compose

Post-process a finished demo video to add intro/outro cards, lower-third text overlays, and background music. The output is a new file (e.g., `demo.composed.mp4`); the original is preserved untouched.

Follows the same 6-phase workflow as the record skill: **discover → storyboard → confirm → execute → QA → hand-off**.

## When to use this skill

The user has a demo video and wants to make it more polished or branded. Typical phrasing:

- "Add a title card to this demo"
- "Put background music behind the demo"
- "Add lower-third captions when each feature appears"
- "Brand the video with our company name at the start"
- "Add an end card with a call-to-action"

If the user wants to record a new demo, use the **record** skill. If they want dialogue between voices, use **multi-speaker**.

## The 6 phases

### Phase 1 — Discover

Ask the user:

1. **Which video do we start from?** (Path; default: the most recent demo at `demo/output/demo.mp4`)
2. **Intro card?** If yes:
   - Title text (and optional subtitle)
   - Duration (default: 3 seconds)
   - Background color (default: black, `#0E0E0E`)
3. **Outro card?** Same questions plus optional CTA text (e.g., "Learn more at xamun.com")
4. **Lower-thirds?** For each one:
   - Text
   - When it should appear (timestamp in the main video, e.g., "at 0:12")
   - How long it should stay (default: 3 seconds)
   - Position (default: bottom-left)
5. **Background music?** If yes:
   - Path to the audio file (mp3, wav, m4a — any ffmpeg-readable format)
   - Volume (default: 0.3, i.e., 30% of original)
   - Should it duck under narration? (default: yes)

If they're vague, suggest defaults. If they don't want some elements (e.g., no music), confirm that explicitly so the storyboard reflects it.

### Phase 2 — Storyboard

Present a composition plan. Use this format:

```
Composition: <video name>
Source:  <input path>
Output:  <output path>

Timeline:
  0:00–0:03   INTRO  "Title" / "Subtitle" / background <color>
  0:03–<N>   MAIN   <input filename>  (existing demo)
    0:08    LOWER-THIRD "Real-time alerts"           (3s, bottom-left)
    0:24    LOWER-THIRD "Twelve hours of headroom"   (3s, bottom-left)
  <N>–<M>   OUTRO  "End text" / "CTA"

Music:
  Track:   <path>
  Volume:  0.3
  Ducking: yes (sidechain compress under narration)
```

Ask: **"Does this composition work, or what should I adjust?"**

Wait for explicit approval. Do not write compose.json or run anything yet.

### Phase 3 — Generate compose.json

After approval, write `demo/compose.json`. See `templates/compose.example.json` for the full schema. Show the file to the user for a final sanity check.

Schema overview:

```json
{
  "input": "demo/output/demo.mp4",
  "output": "demo/output/demo.composed.mp4",
  "intro": {
    "duration": 3,
    "title": "Xamun Intelligence",
    "subtitle": "Always-on strategy governance",
    "background": "#0E0E0E"
  },
  "outro": {
    "duration": 4,
    "title": "See it in action",
    "subtitle": "xamun.com",
    "background": "#0E0E0E"
  },
  "lowerThirds": [
    { "text": "Real-time alerts", "start": 5.0, "duration": 3.0, "position": "bottom-left" }
  ],
  "music": {
    "path": "assets/track.mp3",
    "volume": 0.3,
    "duckUnderNarration": true
  }
}
```

### Phase 4 — Execute

Verify prereqs:

```bash
ffmpeg -version | head -1
ffprobe -version | head -1
ls -la <input video path>
ls -la <music file path>      # if music is configured
```

Run compose:

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/compose.mjs demo/compose.json
```

The script handles font discovery automatically (probes common Linux/macOS font paths). If no system font is found it falls back to the default, which still works but looks plainer. Stream output to the user.

### Phase 5 — QA

After composition, run a basic check on the output:

```bash
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of default <output path>
ls -la <output path>
```

Verify:
- Output file exists and is non-trivial in size (> 100 KB)
- Duration ≈ intro + main + outro (within 1 second)
- Resolution matches the source video
- Both video and audio streams are present

If the user added a music file but the output is unexpectedly quiet, check that the music path was correct and ffmpeg loaded it (the script will warn if the path didn't exist).

### Phase 6 — Hand-off

Present:

```
✓ Composed video ready for review

  Source:    <input path>
  Output:    <output path>
  Duration:  <Ns>  (intro <s> + main <s> + outro <s>)
  Music:     <yes — ducked under narration | yes — constant level | no>
  Size:      <X.X> MB

What to do next:
  • Open the file and review
  • To adjust intro/outro/lower-thirds: edit compose.json and re-run
  • To swap the music track: edit music.path in compose.json and re-run
```

## Lower-third positions

| Position | Where it appears |
|----------|------------------|
| `bottom-left` (default) | Lower-left corner with margin |
| `bottom-right` | Lower-right corner |
| `top-left` | Upper-left corner |
| `top-right` | Upper-right corner |

Lower-third timestamps refer to time within the **main** video. The compose script automatically offsets them by the intro duration when building the final timeline. So `start: 5` means "5 seconds into the original demo," regardless of how long the intro is.

## Music tips

- **Format**: MP3, WAV, M4A, OGG, FLAC — anything ffmpeg can read
- **Length**: The script loops short tracks to cover the full video duration
- **Volume**: 0.2–0.4 works well behind narration; 0.5+ starts to fight the voice
- **Ducking**: When enabled, the script uses ffmpeg's `sidechaincompress` filter so music drops automatically when narration is present. Threshold and ratio are tuned for typical TTS levels. If music still feels too loud during narration, lower `volume` rather than tweaking the sidechain.
- **Avoid**: tracks with vocals or aggressive melodic content — they'll fight the narration even with ducking. Look for ambient, cinematic, or "corporate" tracks.

Free sources: YouTube Audio Library (royalty-free), Pixabay Music, Free Music Archive. Always check licensing for commercial use.

## Reference

- `${CLAUDE_PLUGIN_ROOT}/scripts/compose.mjs` — the composer
- `${CLAUDE_PLUGIN_ROOT}/templates/compose.example.json` — fully-worked example
