#!/usr/bin/env node
// compose.mjs — Post-processes a demo video with intro/outro cards, lower-thirds, and background music.
// Usage: node compose.mjs <compose.json>
//
// compose.json schema:
// {
//   "input": "demo/output/demo.mp4",
//   "output": "demo/output/demo.composed.mp4",
//   "viewport": { "width": 1280, "height": 720 },   // optional; probed if absent
//   "intro": { "duration": 3, "title": "...", "subtitle": "...", "background": "#0E0E0E", "titleColor": "#FFF", "subtitleColor": "#A0A0A0" },
//   "outro": { "duration": 4, "title": "...", "subtitle": "...", "background": "#0E0E0E" },
//   "lowerThirds": [{ "text": "Feature name", "start": 5.0, "duration": 3.0, "position": "bottom-left" }],
//   "music": { "path": "assets/track.mp3", "volume": 0.3, "duckUnderNarration": true }
// }

import { readFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith('--')) {
  console.error('Usage: compose.mjs <compose.json>');
  process.exit(1);
}

const composePath = resolve(args[0]);
const cfg = JSON.parse(readFileSync(composePath, 'utf8'));

const inputPath = resolve(process.cwd(), cfg.input);
const outputPath = resolve(process.cwd(), cfg.output || cfg.input.replace(/\.mp4$/, '.composed.mp4'));
const tempDir = join(tmpdir(), `demo-reel-compose-${Date.now()}`);
mkdirSync(tempDir, { recursive: true });
mkdirSync(dirname(outputPath), { recursive: true });

if (!existsSync(inputPath)) {
  console.error(`✗ Input video not found: ${inputPath}`);
  process.exit(1);
}

// Probe input dimensions / framerate so cards match
function probeJson(args) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function ffmpeg(ffargs, label) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...ffargs], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${label}`);
}

const probe = probeJson(['-show_streams', '-show_format', inputPath]);
const videoStream = probe.streams.find(s => s.codec_type === 'video');
const width = cfg.viewport?.width || videoStream.width;
const height = cfg.viewport?.height || videoStream.height;
const fps = 30; // we'll normalize everything to 30fps

// Font discovery — drawtext needs a real path. Probe common locations.
function findFont() {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    '/Library/Fonts/Arial Bold.ttf',
    '/Library/Fonts/Arial.ttf',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

const fontPath = findFont();
if (!fontPath) {
  console.warn('⚠ No system font found. drawtext will use default font (may look basic).');
}

// Escape text for drawtext filter — colons, single quotes, and backslashes are special
function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\\\\\'").replace(/:/g, '\\:').replace(/,/g, '\\,');
}

function fontArg() {
  return fontPath ? `fontfile='${fontPath.replace(/'/g, "\\'")}':` : '';
}

function makeCard({ duration, title, subtitle, background = '#0E0E0E', titleColor = '#FFFFFF', subtitleColor = '#A0A0A0' }, outPath, label) {
  const titleSize = Math.round(height * 0.08);
  const subSize = Math.round(height * 0.04);

  let drawFilter = '';
  if (title) {
    drawFilter += `drawtext=${fontArg()}text='${esc(title)}':fontsize=${titleSize}:fontcolor=${titleColor}:x=(w-text_w)/2:y=(h-text_h)/2-${Math.round(height * 0.04)}`;
  }
  if (subtitle) {
    if (drawFilter) drawFilter += ',';
    drawFilter += `drawtext=${fontArg()}text='${esc(subtitle)}':fontsize=${subSize}:fontcolor=${subtitleColor}:x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(height * 0.04)}`;
  }

  // Build a colored canvas video + silent audio of the right duration
  const vfilter = drawFilter ? `-vf` : null;
  const ffargs = [
    '-f', 'lavfi', '-i', `color=c=${background.replace('#', '0x')}:s=${width}x${height}:d=${duration}:r=${fps}`,
    '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=48000`,
  ];
  if (drawFilter) ffargs.push('-vf', drawFilter);
  ffargs.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', String(duration), '-shortest',
    outPath
  );
  ffmpeg(ffargs, label);
}

// Step 1: Build intro card if requested
const parts = [];

if (cfg.intro) {
  console.log('▶ Building intro card');
  const introPath = join(tempDir, 'intro.mp4');
  makeCard({ ...cfg.intro }, introPath, 'intro');
  parts.push(introPath);
}

// Step 2: Re-encode main video to match parameters (so concat works cleanly).
console.log('▶ Normalizing main video');
const mainPath = join(tempDir, 'main.mp4');
ffmpeg([
  '-i', inputPath,
  '-vf', `fps=${fps},scale=${width}:${height}:force_original_aspect_ratio=disable`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
  mainPath
], 'normalize main');
parts.push(mainPath);

// Step 3: Outro card
if (cfg.outro) {
  console.log('▶ Building outro card');
  const outroPath = join(tempDir, 'outro.mp4');
  makeCard({ ...cfg.outro }, outroPath, 'outro');
  parts.push(outroPath);
}

// Step 4: Concat all parts using filter_complex (handles any small mismatches via re-encode)
console.log('▶ Concatenating parts');
const concatened = join(tempDir, 'concat.mp4');
if (parts.length === 1) {
  // No intro/outro — just use main
  ffmpeg(['-i', parts[0], '-c', 'copy', concatened], 'copy main');
} else {
  const inputs = parts.flatMap(p => ['-i', p]);
  const streams = parts.map((_, i) => `[${i}:v][${i}:a]`).join('');
  ffmpeg([
    ...inputs,
    '-filter_complex', `${streams}concat=n=${parts.length}:v=1:a=1[v][a]`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    concatened
  ], 'concat parts');
}

// Step 5: Lower-thirds overlay (text boxes at timestamps).
// Timestamps in compose.json refer to the MAIN video, so we need to offset by intro duration.
let lowerThirdsApplied = concatened;
if (cfg.lowerThirds && cfg.lowerThirds.length > 0) {
  console.log(`▶ Applying ${cfg.lowerThirds.length} lower-third overlay(s)`);
  const introOffset = cfg.intro?.duration || 0;
  const ltSize = Math.round(height * 0.035);
  const ltFilters = cfg.lowerThirds.map(lt => {
    const start = (lt.start ?? 0) + introOffset;
    const end = start + (lt.duration ?? 3);
    let x, y;
    switch (lt.position || 'bottom-left') {
      case 'bottom-right': x = `w-text_w-${Math.round(width * 0.04)}`; y = `h-text_h-${Math.round(height * 0.08)}`; break;
      case 'top-left':     x = String(Math.round(width * 0.04));      y = String(Math.round(height * 0.06));        break;
      case 'top-right':    x = `w-text_w-${Math.round(width * 0.04)}`; y = String(Math.round(height * 0.06));        break;
      case 'bottom-left':
      default:             x = String(Math.round(width * 0.04));      y = `h-text_h-${Math.round(height * 0.08)}`; break;
    }
    return `drawtext=${fontArg()}text='${esc(lt.text)}':fontsize=${ltSize}:fontcolor=white:x=${x}:y=${y}:box=1:boxcolor=black@0.6:boxborderw=12:enable='between(t,${start},${end})'`;
  }).join(',');

  const withLt = join(tempDir, 'with_lt.mp4');
  ffmpeg([
    '-i', concatened,
    '-vf', ltFilters,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'copy',
    withLt
  ], 'lower thirds');
  lowerThirdsApplied = withLt;
}

// Step 6: Background music with sidechain ducking under narration
let final = lowerThirdsApplied;
if (cfg.music && cfg.music.path) {
  const musicPath = resolve(process.cwd(), cfg.music.path);
  if (!existsSync(musicPath)) {
    console.warn(`⚠ Music file not found: ${musicPath} — skipping music`);
  } else {
    console.log('▶ Adding background music' + (cfg.music.duckUnderNarration ? ' (with ducking)' : ''));
    const withMusic = join(tempDir, 'with_music.mp4');
    const vol = cfg.music.volume ?? 0.3;

    if (cfg.music.duckUnderNarration) {
      // Sidechain compress: when narration is present, duck the music.
      ffmpeg([
        '-i', lowerThirdsApplied,
        '-stream_loop', '-1', '-i', musicPath,
        '-filter_complex',
        `[1:a]volume=${vol}[bgraw];` +
        `[0:a]asplit=2[narr1][narr2];` +
        `[bgraw][narr1]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=300[bgduck];` +
        `[narr2][bgduck]amix=inputs=2:duration=first:dropout_transition=0[mixed]`,
        '-map', '0:v', '-map', '[mixed]',
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest',
        withMusic
      ], 'music with ducking');
    } else {
      // Simple mix
      ffmpeg([
        '-i', lowerThirdsApplied,
        '-stream_loop', '-1', '-i', musicPath,
        '-filter_complex',
        `[1:a]volume=${vol}[bg];[0:a][bg]amix=inputs=2:duration=first[mixed]`,
        '-map', '0:v', '-map', '[mixed]',
        '-c:v', 'copy',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest',
        withMusic
      ], 'music mix');
    }
    final = withMusic;
  }
}

// Final move to output path
ffmpeg(['-i', final, '-c', 'copy', outputPath], 'final copy');

// Cleanup temp files
for (const f of parts) {
  try { unlinkSync(f); } catch {}
}
try { unlinkSync(concatened); } catch {}
if (lowerThirdsApplied !== concatened) { try { unlinkSync(lowerThirdsApplied); } catch {} }
if (final !== lowerThirdsApplied && final !== concatened) { try { unlinkSync(final); } catch {} }

console.log(`\n✓ Composed: ${outputPath}`);
