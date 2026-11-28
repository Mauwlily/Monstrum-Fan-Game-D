import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MOUSE_SENSITIVITY,
  getDefaultGraphicsSettings,
  sanitizeGraphicsSettings,
} from './graphicsSettings';

test('default mouseSensitivity is 1.0', () => {
  const def = getDefaultGraphicsSettings();
  assert.equal(def.mouseSensitivity, DEFAULT_MOUSE_SENSITIVITY);
  assert.equal(def.mouseSensitivity, 1.0);
});

test('sanitizeGraphicsSettings preserves arbitrary uncapped positive mouseSensitivity values', () => {
  for (const val of [0.25, 1.5, 5, 18, 50, 250, 9999.5]) {
    const out = sanitizeGraphicsSettings({ mouseSensitivity: val });
    assert.equal(out.mouseSensitivity, val);
  }
});

test('sanitizeGraphicsSettings clamps tiny positive values to 0.01 and rejects non-positive/NaN', () => {
  assert.equal(sanitizeGraphicsSettings({ mouseSensitivity: 0.001 }).mouseSensitivity, 0.01);
  assert.equal(sanitizeGraphicsSettings({ mouseSensitivity: 0 }).mouseSensitivity, 1.0);
  assert.equal(sanitizeGraphicsSettings({ mouseSensitivity: -4 }).mouseSensitivity, 1.0);
  assert.equal(sanitizeGraphicsSettings({ mouseSensitivity: Number.NaN }).mouseSensitivity, 1.0);
  assert.equal(sanitizeGraphicsSettings({ mouseSensitivity: Number.POSITIVE_INFINITY }).mouseSensitivity, 1.0);
});
