#!/usr/bin/env node
// qa.mjs — Quality-checks the pipeline output before hand-off.
// Usage: node qa.mjs <scenes.json> --out <outDir> [--final <path>] [--silent]
//
// Exit code 0 = clean (or only warnings), 1 = critical issues.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const scenesPath = resolve(args[0]);
const outDir = resolve(args[args.indexOf('--out') + 1]);
const silent = args.includes('--silent');

const config = JSON.parse(readFileSync(scenesPath, 'utf8'));
const finalPath = args.includes('--final')
  ? resolve(args[args.indexOf('--final') + 1])
  : resolve(process.cwd(), config.output || 'demo/output/demo.mp4');

const clipsDir = join(outDir, 'clips');
const audioDir = join(outDir, 'audio');
const mergedDir = join(outDir, 'merged');

const issues = []; // { level: 'error' | 'warning' | 'info', scene?, message }

function ffprobeJson(args) {
  const res = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', ...args], { encoding: 'utf8' });
  if (res.status !== 0) return null;
  try { return JSON.parse(res.stdout); } catch { return null; }
}

function probeDuration(path) {
  const data = ffprobeJson(['-show_entries', 'format=duration', path]);
  return data ? parseFloat(data.format?.duration ?? 0) : 0;
}

function probeStreams(path) {
  const data = ffprobeJson(['-show_streams', path]);
  return data?.streams ?? [];
}

function detectBlackFrames(videoPath) {
  // Use blackdetect to find black sequences ≥ 1s with picture brightness < 0.10
  const res = spawnSync('ffmpeg', [
    '-i', videoPath,
    '-vf', 'blackdetect=d=1.0:pix_th=0.10',
    '-an', '-f', 'null', '-'
  ], { encoding: 'utf8' });
  const matches = [...(res.stderr || '').matchAll(/blackdetect.*?black_start:(\S+).*?black_end:(\S+).*?black_duration:(\S+)/g)];
  return matches.map(m => ({ start: parseFloat(m[1]), end: parseFloat(m[2]), duration: parseFloat(m[3]) }));
}

function detectSilentAudio(audioPath) {
  // Use ebur128 to measure integrated loudness (LUFS). -70 LUFS or lower = effectively silent.
  const res = spawnSync('ffmpeg', [
    '-i', audioPath,
    '-filter_complex', 'ebur128=peak=true',
    '-f', 'null', '-'
  ], { encoding: 'utf8' });
  const match = (res.stderr || '').match(/Integrated loudness:\s*\n\s*I:\s*(-?\d+\.?\d*)\s*LUFS/);
  return match ? parseFloat(match[1]) : null;
}

function checkScene(scene) {
  const id = scene.id;
  const isMulti = scene.speakers && scene.dialogue;
  const hasNarrationContent = isMulti
    ? (scene.dialogue && scene.dialogue.length > 0)
    : (scene.narration && scene.narration.trim());

  // 1. Clip exists and is non-trivial size
  const clipPath = join(clipsDir, `${id}.webm`);
  if (!existsSync(clipPath)) {
    issues.push({ level: 'error', scene: id, message: `Missing video clip: ${clipPath}` });
    return;
  }
  const clipSize = statSync(clipPath).size;
  if (clipSize < 10000) {
    issues.push({ level: 'error', scene: id, message: `Video clip is suspiciously small (${clipSize} bytes) — recording likely failed` });
  }

  // 2. Black-frame detection
  const blackSequences = detectBlackFrames(clipPath);
  const totalBlack = blackSequences.reduce((s, b) => s + b.duration, 0);
  const clipDur = probeDuration(clipPath);
  if (clipDur > 0 && totalBlack / clipDur > 0.4) {
    issues.push({ level: 'warning', scene: id, message: `Clip is ${Math.round(totalBlack / clipDur * 100)}% black frames (${totalBlack.toFixed(1)}s) — page may not have rendered` });
  } else if (blackSequences.length > 0 && blackSequences.some(b => b.duration > 2)) {
    const longest = Math.max(...blackSequences.map(b => b.duration));
    issues.push({ level: 'info', scene: id, message: `${longest.toFixed(1)}s black segment detected — may be intentional (page load)` });
  }

  // 3. Audio check (skip if silent mode or no narration)
  if (!silent && hasNarrationContent) {
    const audioPath = join(audioDir, `${id}.wav`);
    if (!existsSync(audioPath)) {
      issues.push({ level: 'error', scene: id, message: `Missing audio: ${audioPath} — TTS may have failed` });
    } else {
      const audioSize = statSync(audioPath).size;
      if (audioSize < 1000) {
        issues.push({ level: 'error', scene: id, message: `Audio file is too small (${audioSize} bytes)` });
      } else {
        const lufs = detectSilentAudio(audioPath);
        if (lufs !== null && lufs < -60) {
          issues.push({ level: 'warning', scene: id, message: `Audio is very quiet (${lufs.toFixed(1)} LUFS) — TTS may have produced silence` });
        }
      }
    }
  }

  // 4. Merged scene exists
  const mergedPath = join(mergedDir, `${id}.mp4`);
  if (!existsSync(mergedPath)) {
    issues.push({ level: 'error', scene: id, message: `Missing merged output: ${mergedPath}` });
  }
}

function checkFinal() {
  if (!existsSync(finalPath)) {
    issues.push({ level: 'error', message: `Final output missing: ${finalPath}` });
    return;
  }

  const size = statSync(finalPath).size;
  if (size < 50000) {
    issues.push({ level: 'error', message: `Final output is suspiciously small (${size} bytes)` });
  }

  const streams = probeStreams(finalPath);
  const hasVideo = streams.some(s => s.codec_type === 'video');
  const hasAudio = streams.some(s => s.codec_type === 'audio');
  const totalDur = probeDuration(finalPath);

  if (!hasVideo) issues.push({ level: 'error', message: `Final output has no video stream` });
  if (!silent && !hasAudio) issues.push({ level: 'error', message: `Final output has no audio stream (and --silent was not set)` });

  // Duration sanity: should roughly equal sum of merged scenes
  const expectedScenes = config.scenes.length;
  if (totalDur < expectedScenes * 1.5) {
    issues.push({ level: 'warning', message: `Final video is only ${totalDur.toFixed(1)}s for ${expectedScenes} scenes — may be incomplete` });
  }

  // Resolution check
  const videoStream = streams.find(s => s.codec_type === 'video');
  if (videoStream && config.viewport) {
    const expectedW = config.viewport.width;
    const expectedH = config.viewport.height;
    if (videoStream.width !== expectedW || videoStream.height !== expectedH) {
      issues.push({ level: 'info', message: `Final resolution ${videoStream.width}x${videoStream.height} differs from configured ${expectedW}x${expectedH}` });
    }
  }

  return { size, duration: totalDur, hasAudio, hasVideo };
}

function main() {
  console.log(`▶ QA: ${finalPath}\n`);

  for (const scene of config.scenes) {
    checkScene(scene);
  }
  const finalInfo = checkFinal();

  const errors = issues.filter(i => i.level === 'error');
  const warnings = issues.filter(i => i.level === 'warning');
  const infos = issues.filter(i => i.level === 'info');

  function fmt(arr, icon) {
    return arr.map(i => `  ${icon} ${i.scene ? `[${i.scene}] ` : ''}${i.message}`).join('\n');
  }

  if (errors.length) console.log(`✗ Errors (${errors.length}):\n${fmt(errors, '✗')}\n`);
  if (warnings.length) console.log(`⚠ Warnings (${warnings.length}):\n${fmt(warnings, '⚠')}\n`);
  if (infos.length) console.log(`ℹ Info (${infos.length}):\n${fmt(infos, 'ℹ')}\n`);

  if (finalInfo) {
    const sizeMb = (finalInfo.size / 1024 / 1024).toFixed(2);
    console.log(`Summary:`);
    console.log(`  Duration: ${finalInfo.duration.toFixed(1)}s`);
    console.log(`  Size:     ${sizeMb} MB`);
    console.log(`  Video:    ${finalInfo.hasVideo ? '✓' : '✗'}`);
    console.log(`  Audio:    ${finalInfo.hasAudio ? '✓' : silent ? '⊘ (silent mode)' : '✗'}`);
  }

  if (errors.length > 0) {
    console.log(`\n✗ QA failed (${errors.length} error${errors.length === 1 ? '' : 's'})`);
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log(`\n⚠ QA passed with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`);
  } else {
    console.log(`\n✓ QA clean`);
  }
}

main();
