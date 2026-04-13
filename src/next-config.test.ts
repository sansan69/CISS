import nextConfig from '../next.config';
import {describe, expect, it} from 'vitest';

describe('next.config', () => {
  it('pins outputFileTracingRoot to the repo root', () => {
    expect(nextConfig.outputFileTracingRoot).toBe(process.cwd());
  });

  it('keeps modern image formats enabled', () => {
    expect(nextConfig.images?.formats).toEqual(['image/avif', 'image/webp']);
  });
});
