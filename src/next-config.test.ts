import nextConfig from '../next.config';
import {describe, expect, it} from 'vitest';

describe('next.config', () => {
  it('does not override outputFileTracingRoot outside the repo root', () => {
    expect(nextConfig.outputFileTracingRoot).toBeUndefined();
  });

  it('keeps modern image formats enabled', () => {
    expect(nextConfig.images?.formats).toEqual(['image/avif', 'image/webp']);
  });
});
