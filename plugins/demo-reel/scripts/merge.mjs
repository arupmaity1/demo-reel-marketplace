#!/usr/bin/env node
// merge.mjs — Merges per-scene video + audio into the final demo.
// For each scene: pad video to match audio duration (freeze last frame), overlay audio.
// Then concatenate all scenes into a single mp4.
// Usage: node merge.mjs <scenes.json> --out <outDir> [--silent] [--scene <id>]

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const scenesPath = resolve(args[0]);
const outDir = resolve(args[args.indexOf('--out') + 1]);
const silent = args.includes('--silent');
const onlyScene = args.includes('--scene') ? args[args.indexOf('--scene') + 1] : null;

const config = JSON.parse(readFileSync(scenesPath, 'utf8'));
const finalPath = args.includes('--final')
  ? resolve(args[args.indexOf('--final') + 1])
  : resolve(process.cwd(), config.output || 'demo/output/demo.mp4');

const clipsDir = join(outDir, 'clips');
const audioDir = join(outDir, 'audio');
const mergedDir = join(outDir, 'merged');
mkdirSync(mergedDir, { recursive: true });
mkdirSync(dirname(finalPath), { recursive: true });

function ffmpeg(args, label) {
  const res = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  if (res.status !== 0) throw new Error(`ffmpeg failed: ${label}`);
}

function probeDuration(path) {
  const res = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', path
  ], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`ffprobe failed for ${path}`);
  return parseFloat(res.stdout.trim());
}

function mergeScene(scene) {
  const video = join(clipsDir, `${scene.id}.webm`);
  const audio = join(audioDir, `${scene.id}.wav`);
  const out = join(mergedDir, `${scene.id}.mp4`);

  if (!existsSync(video)) {
    console.warn(`  ⚠ No video for ${scene.id}, skipping`);
    return null;
  }

  if (silent || !existsSync(audio)) {
    // Just re-encode video to mp4, no audio.
    ffmpeg([
      '-i', video,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-an',
      out
    ], `encode ${scene.id} (no audio)`);
    return out;
  }

  // Pad video to audio duration. Strategy: use -shortest with the longer of (video, audio) on a loop of the last frame.
  // Simpler approach: use tpad to freeze the last frame to match audio length.
  const audioDur = probeDuration(audio);
  const videoDur = probeDuration(video);
  const padSeconds = Math.max(0, audioDur - videoDur + 0.2); // +0.2s tail breathing room

  ffmpeg([
    '-i', video,
    '-i', audio,
    '-filter_complex',
    `[0:v]tpad=stop_mode=clone:stop_duration=${padSeconds.toFixed(3)},fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2[v]`,
    '-map', '[v]',
    '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    out
  ], `merge ${scene.id}`);
  return out;
}

function concatenate(parts) {
  const listPath = join(mergedDir, 'concat.txt');
  writeFileSync(listPath, parts.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
  ffmpeg([
    '-f', 'concat', '-safe', '0',
    '-i', listPath,
    '-c', 'copy',
    finalPath
  ], 'final concat');
}

function main() {
  const scenes = onlyScene
    ? config.scenes.filter(s => s.id === onlyScene)
    : config.scenes;

  const parts = [];
  for (let i = 0; i < scenes.length; i++) {
    console.log(`  [${i + 1}/${scenes.length}] ${scenes[i].id}`);
    const merged = mergeScene(scenes[i]);
    if (merged) parts.push(merged);
  }

  if (parts.length === 0) {
    console.error('✗ No scenes merged');
    process.exit(1);
  }

  if (parts.length === 1 || onlyScene) {
    // Single scene mode — just copy the one file.
    ffmpeg(['-i', parts[0], '-c', 'copy', finalPath], 'single scene copy');
  } else {
    concatenate(parts);
  }

  console.log(`  ✓ ${finalPath}`);
}

try {
  main();
} catch (err) {
  console.error(`✗ Merge failed: ${err.message}`);
  process.exit(1);
}
