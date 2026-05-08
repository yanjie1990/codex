import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAnglePrompt, computeCameraPosition } from '../src/camera-prompt.js';

test('top-down preview position does not become a rear view prompt', () => {
  const position = computeCameraPosition({ xRot: 90, yRot: 0, zDist: -1.4 });

  assert.deepEqual(position, { x: 0, y: 1.4, z: 0 });

  const prompt = buildAnglePrompt({ xRot: 90, yRot: 0, zDist: -1.4, locale: 'en' });

  assert.match(prompt, /top-down|overhead|above/i);
  assert.doesNotMatch(prompt, /back view|behind the subject|rear-facing/i);
});

test('top-dominant mixed-axis prompt overrides original low-angle composition', () => {
  const position = computeCameraPosition({ xRot: 65, yRot: 69, zDist: -2.3 });

  assert.deepEqual(position, { x: -0.9, y: 2.1, z: -0.3 });

  const prompt = buildAnglePrompt({ xRot: 65, yRot: 69, zDist: -2.3, locale: 'en' });

  assert.match(prompt, /top-down|overhead|above/i);
  assert.match(prompt, /Do not preserve the original camera angle/i);
  assert.match(prompt, /top-facing surfaces|ground\/table plane/i);
  assert.match(prompt, /Avoid low-angle upward views/i);
  assert.doesNotMatch(prompt, /Primary viewpoint: rear-facing/i);
});

test('level negative z position still creates a rear view prompt', () => {
  const position = computeCameraPosition({ xRot: 0, yRot: 0, zDist: -1.4 });

  assert.deepEqual(position, { x: 0, y: 0, z: -1.4 });

  const prompt = buildAnglePrompt({ xRot: 0, yRot: 0, zDist: -1.4, locale: 'en' });

  assert.match(prompt, /rear-facing|behind the subject/i);
  assert.doesNotMatch(prompt, /top-down|overhead/i);
});

test('chinese prompt also treats vertical top-down as the primary view', () => {
  const prompt = buildAnglePrompt({ xRot: 90, yRot: 0, zDist: -1.4, locale: 'zh-CN' });

  assert.match(prompt, /顶部俯视|鸟瞰|从上往下/);
  assert.doesNotMatch(prompt, /背面视角/);
});
