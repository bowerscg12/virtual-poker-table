import { TIME_BANK_MAX_USES } from '@vct/shared-types';

/**
 * lobbyId → (userId → remaining time-bank extensions). Granted lazily at the configured max on
 * first read and decremented per use; does not refill until the player re-sits (entry cleared on
 * stand/spectate). In-memory only — a server restart resets budgets to full, which favors players.
 */
const timeBankBudgets = new Map<string, Map<string, number>>();

export function getTimeBankRemaining(lobbyId: string, userId: string): number {
  const lobbyMap = timeBankBudgets.get(lobbyId);
  if (!lobbyMap || !lobbyMap.has(userId)) return TIME_BANK_MAX_USES;
  return lobbyMap.get(userId)!;
}

export function setTimeBankRemaining(lobbyId: string, userId: string, remaining: number): void {
  let lobbyMap = timeBankBudgets.get(lobbyId);
  if (!lobbyMap) {
    lobbyMap = new Map();
    timeBankBudgets.set(lobbyId, lobbyMap);
  }
  lobbyMap.set(userId, Math.max(0, remaining));
}

/** Reset a player's time-bank budget so a re-sit starts fresh (called when they leave their seat). */
export function clearTimeBankForUser(lobbyId: string, userId: string): void {
  timeBankBudgets.get(lobbyId)?.delete(userId);
}

/** Drop all time-bank budgets for a lobby (called on lobby teardown). */
export function clearTimeBankForLobby(lobbyId: string): void {
  timeBankBudgets.delete(lobbyId);
}
