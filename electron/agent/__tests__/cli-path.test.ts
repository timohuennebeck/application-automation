import { describe, expect, it } from 'vitest';
import { claudeCliPath, outsideAsar } from '../cli-path.ts';

describe('outsideAsar', () => {
  it('redirects a path inside app.asar to the unpacked mirror', () => {
    expect(outsideAsar('/Apps/X.app/Contents/Resources/app.asar/node_modules/p/claude')).toBe(
      '/Apps/X.app/Contents/Resources/app.asar.unpacked/node_modules/p/claude',
    );
  });

  it('leaves dev paths and already-unpacked paths alone', () => {
    const dev = '/Users/me/project/node_modules/p/claude';
    const unpacked = '/Apps/X.app/Contents/Resources/app.asar.unpacked/node_modules/p/claude';
    expect(outsideAsar(dev)).toBe(dev);
    expect(outsideAsar(unpacked)).toBe(unpacked);
  });
});

describe('claudeCliPath', () => {
  it('finds the platform binary of the installed SDK', () => {
    expect(claudeCliPath()).toMatch(/claude-agent-sdk-[a-z0-9]+-[a-z0-9]+[\\/]claude(\.exe)?$/);
  });
});
