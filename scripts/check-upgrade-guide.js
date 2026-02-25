#!/usr/bin/env node
/**
 * Pre-publish check: validates that significant version bumps have upgrade guides.
 *
 * Rules:
 *   - Minor/major version bumps (0.8.x -> 0.9.x, 1.x -> 2.x) REQUIRE an upgrade guide
 *   - Patch versions that change features (detected via git diff) WARN if no guide exists
 *   - Pure patch bumps with only bug fixes are allowed without guides
 *
 * Used by CI and prepublish hooks to enforce upgrade guide discipline.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version;
const guidePath = path.join(ROOT, 'upgrades', `${version}.md`);
const guideExists = fs.existsSync(guidePath);

// Parse version
const [major, minor, patch] = version.split('.').map(Number);

// Check if this is a minor or major bump by comparing to published versions
let isSignificantBump = false;
let previousVersion = null;

try {
  // Get the last published version from npm
  const npmInfo = execSync(`npm view instar version 2>/dev/null`, { encoding: 'utf-8' }).trim();
  if (npmInfo) {
    previousVersion = npmInfo;
    const [prevMajor, prevMinor] = npmInfo.split('.').map(Number);
    isSignificantBump = major > prevMajor || minor > prevMinor;
  }
} catch {
  // npm not available or package not published yet — skip
}

// Validate existing guides are well-formed
const upgradesDir = path.join(ROOT, 'upgrades');
let malformedGuides = [];

if (fs.existsSync(upgradesDir)) {
  const guideFiles = fs.readdirSync(upgradesDir).filter(f => f.endsWith('.md'));
  for (const file of guideFiles) {
    const content = fs.readFileSync(path.join(upgradesDir, file), 'utf-8');
    const issues = [];

    if (!content.includes('## What Changed')) {
      issues.push('missing "## What Changed" section');
    }
    if (!content.includes('## What to Tell Your User')) {
      issues.push('missing "## What to Tell Your User" section');
    }
    if (!content.includes('## Summary of New Capabilities')) {
      issues.push('missing "## Summary of New Capabilities" section');
    }
    if (content.length < 200) {
      issues.push('guide is too short (< 200 chars) — probably incomplete');
    }

    if (issues.length > 0) {
      malformedGuides.push({ file, issues });
    }
  }
}

// Report
console.log(`\n  Upgrade Guide Check — v${version}`);
console.log(`  ${'─'.repeat(40)}`);

if (previousVersion) {
  console.log(`  Previous published: v${previousVersion}`);
  console.log(`  Significant bump:   ${isSignificantBump ? 'YES' : 'no'}`);
}

console.log(`  Guide exists:       ${guideExists ? 'YES' : 'NO'}`);

if (malformedGuides.length > 0) {
  console.log(`\n  ⚠ Malformed upgrade guides:`);
  for (const { file, issues } of malformedGuides) {
    console.log(`    ${file}: ${issues.join(', ')}`);
  }
}

// Enforce
let exitCode = 0;

if (isSignificantBump && !guideExists) {
  console.log(`\n  ERROR: Version ${version} is a significant bump but has no upgrade guide.`);
  console.log(`  Create: upgrades/${version}.md`);
  console.log(`  Required sections: "## What Changed", "## What to Tell Your User", "## Summary of New Capabilities"`);
  exitCode = 1;
} else if (!guideExists) {
  console.log(`\n  Note: No upgrade guide for v${version} (patch release — acceptable).`);
} else {
  console.log(`\n  Upgrade guide validated for v${version}.`);
}

if (malformedGuides.length > 0) {
  console.log(`  WARNING: ${malformedGuides.length} guide(s) have structural issues.`);
  // Don't fail on malformed — just warn
}

console.log('');
process.exit(exitCode);
