import { describe, it, expect } from 'vitest';
import { renderPlist, daemonStatus } from '../../src/daemon.js';

describe('launchd plist rendering', () => {
  it('leaves no unsubstituted template tokens', () => {
    // ISS-0127: an unfilled {{TOKEN}} yields a plist launchd silently refuses.
    const { plist } = renderPlist({ port: 4888 });
    expect(plist).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it('points the agent at the env file, since launchd inherits no login shell', () => {
    const { plist } = renderPlist();
    expect(plist).toMatch(/--env-file-if-exists=.*\.decibel\/env/);
  });

  it('renders the requested port into the daemon arguments', () => {
    const { plist, port } = renderPlist({ port: 4999 });
    expect(port).toBe(4999);
    expect(plist).toContain('<string>4999</string>');
  });

  it('grants pro only when the installing environment already opted in', () => {
    const prior = process.env.DECIBEL_PRO;
    try {
      delete process.env.DECIBEL_PRO;
      expect(renderPlist().plist).not.toContain('DECIBEL_PRO');
      process.env.DECIBEL_PRO = '1';
      expect(renderPlist().plist).toContain('<key>DECIBEL_PRO</key>');
    } finally {
      if (prior === undefined) delete process.env.DECIBEL_PRO;
      else process.env.DECIBEL_PRO = prior;
    }
  });
});

describe('daemon status', () => {
  it('reports whether launchd holds the job separately from whether a plist exists', () => {
    // The old code conflated these, so a plist that never loaded read as installed.
    const status = daemonStatus();
    expect(typeof status.launchd).toBe('boolean');
    expect(typeof status.launchdPlist).toBe('boolean');
  });
});
