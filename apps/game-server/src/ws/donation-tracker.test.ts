import { describe, it, expect } from 'vitest';
import { hasDonationId, trackDonationId } from './donation-tracker.js';

describe('donation idempotency tracker', () => {
  it('reports an id as unseen until it is tracked', () => {
    expect(hasDonationId('don-1')).toBe(false);
    trackDonationId('don-1');
    expect(hasDonationId('don-1')).toBe(true);
  });

  it('treats distinct ids independently', () => {
    trackDonationId('don-2');
    expect(hasDonationId('don-2')).toBe(true);
    expect(hasDonationId('don-never')).toBe(false);
  });
});
