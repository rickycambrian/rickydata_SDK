import { createRickyDataTailwindPreset } from '../src/index.js';

describe('@rickydata/tailwind-preset', () => {
  it('creates a preset with RickyData semantic colors', () => {
    const preset = createRickyDataTailwindPreset();
    const colors = (preset.theme as { extend?: { colors?: Record<string, unknown> } }).extend?.colors || {};

    expect(colors.surface).toBeDefined();
    expect(colors.accent).toBeDefined();
    expect(colors.rd).toBeDefined();
  });
});
