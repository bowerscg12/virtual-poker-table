/**
 * Recently-processed donation IDs. Capped at MAX_DONATION_IDS entries (FIFO eviction) to
 * prevent a reconnect-retry from crediting a donation twice.
 */
const processedDonationIds = new Set<string>();
const MAX_DONATION_IDS = 10_000;

/** True when this donation ID has already been processed (idempotency guard). */
export function hasDonationId(id: string): boolean {
  return processedDonationIds.has(id);
}

export function trackDonationId(id: string): void {
  if (processedDonationIds.size >= MAX_DONATION_IDS) {
    const first = processedDonationIds.values().next().value as string;
    processedDonationIds.delete(first);
  }
  processedDonationIds.add(id);
}
