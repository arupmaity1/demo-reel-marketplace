#!/usr/bin/env node
// pipeline.mjs — Orchestrates record → narrate → merge.
// Usage: node pipeline.mjs <scenes.json> [--silent] [--no-record] [--no-narrate] [--scene <id>]
//
// Paths in scenes.json (output, etc.) are resolved relative to CWD.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
if (args.length === 0 || args[0].startsWith('--')) {
  console.error('Usage: pipeline.mjs <scenes.json> [--silent] [--no-record] [--no-narrate] [--scene <id>]');
  process.exit(1);
}

const scenesPath = resolve(args[0]);
const flags = {
  silent: args.includes('--silent'),
  noRecord: args.includes('--no-record'),
  noNarrate: args.includes('--no-narrate'),
  scene: args.includes('--scene') ? args[args.indexOf('--scene') + 1] : null,
};

if (!existsSync(scenesPath)) {
  console.error(`✗ Scenes file not found: ${scenesPath}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(scenesPath, 'utf8'));
const finalPath = resolve(process.cwd(), config.output || 'demo/output/demo.mp4');
const baseOutDir = dirname(finalPath);

mkdirSync(baseOutDir, { recursive: true });
mkdirSync(join(baseOutDir, 'clips'), { recursive: true });
mkdirSync(join(baseOutDir, 'audio'), { recursive: true });
mkdirSync(join(baseOutDir, 'merged'), { recursive: true });

function run(cmd, scriptArgs) {
  return new Promise((res, rej) => {
    const child = spawn('node', [cmd, ...scriptArgs], { stdio: 'inherit' });
    child.on('exit', code => code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`)));
  });
}

async function main() {
  console.log(`▶ demo-reel pipeline`);
  console.log(`  scenes:  ${scenesPath}`);
  console.log(`  output:  ${finalPath}`);
  if (flags.scene) console.log(`  scene:   ${flags.scene} (single-scene mode)`);
  if (flags.silent) console.log(`  audio:   disabled (--silent)`);

  const baseArgs = [scenesPath, '--out', baseOutDir];
  const sceneArgs = flags.scene ? ['--scene', flags.scene] : [];

  if (!flags.noRecord) {
    console.log(`\n▶ Stage 1/4: recording browser`);
    await run(join(__dirname, 'record.mjs'), [...baseArgs, ...sceneArgs]);
  } else {
    console.log(`\n⊘ Stage 1/4: skipping recording (--no-record)`);
  }

  if (!flags.silent && !flags.noNarrate) {
    console.log(`\n▶ Stage 2/4: generating narration`);
    await run(join(__dirname, 'narrate.mjs'), [...baseArgs, ...sceneArgs]);
  } else if (flags.silent) {
    console.log(`\n⊘ Stage 2/4: skipping narration (--silent)`);
  } else {
    console.log(`\n⊘ Stage 2/4: skipping narration (--no-narrate)`);
  }

  console.log(`\n▶ Stage 3/4: merging`);
  const mergeArgs = [...baseArgs, '--final', finalPath, ...sceneArgs];
  if (flags.silent) mergeArgs.push('--silent');
  await run(join(__dirname, 'merge.mjs'), mergeArgs);

  console.log(`\n▶ Stage 4/4: QA`);
  const qaArgs = [...baseArgs, '--final', finalPath];
  if (flags.silent) qaArgs.push('--silent');
  try {
    await run(join(__dirname, 'qa.mjs'), qaArgs);
  } catch (err) {
    console.error(`\n⚠ QA reported issues. The file exists at ${finalPath} but should be reviewed.`);
    process.exit(2);
  }

  console.log(`\n✓ Done: ${finalPath}`);
}

main().catch(err => {
  console.error(`\n✗ Pipeline failed: ${err.message}`);
  process.exit(1);
});
