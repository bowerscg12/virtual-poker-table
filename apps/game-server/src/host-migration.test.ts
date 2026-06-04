import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initLobbyStore,
  createLobby,
  autoSeatPlayer,
  getLobbyById,
  removeSeat,
  kickSeat,
  claimHostIfVacant,
  setSittingOut,
  setTableBuyIn,
} from './services/lobby.js';
import { guestLogin } from './services/auth.js';
import { memoryStore } from './store/memory-fallback.js';

/**
 * Force deterministic tenure ordering: assign each listed user an ascending seatedAt so
 * host succession never depends on same-millisecond ties in a fast test.
 */
function setJoinOrder(lobbyId: string, userIdsInOrder: string[]): void {
  const mem = memoryStore.lobbies.get(lobbyId)!;
  userIdsInOrder.forEach((uid, i) => {
    const seat = mem.seats.find((s) => s.userId === uid);
    if (seat) seat.seatedAt = new Date(1_700_000_000_000 + i * 1000).toISOString();
  });
}

async function makeTable(names: string[]) {
  const users = [] as { id: string; displayName: string }[];
  for (const name of names) users.push(await guestLogin(name));
  const lobby = await createLobby(users[0].id, { presetId: 'nlhe-standard' } as any);
  for (let i = 1; i < users.length; i++) {
    await autoSeatPlayer(lobby.id, users[i].id, users[i].displayName);
  }
  setJoinOrder(lobby.id, users.map((u) => u.id));
  return { lobbyId: lobby.id, users };
}

describe('host migration', () => {
  // This suite pokes memoryStore directly, so it must run against the in-memory
  // store even when CI provides a Postgres service. Force memory mode here.
  const prevForceMemory = process.env.FORCE_MEMORY_STORE;
  beforeAll(async () => {
    process.env.FORCE_MEMORY_STORE = '1';
    await initLobbyStore();
  });

  afterAll(() => {
    if (prevForceMemory === undefined) delete process.env.FORCE_MEMORY_STORE;
    else process.env.FORCE_MEMORY_STORE = prevForceMemory;
  });

  it('passes host to the longest-tenured remaining player in join order', async () => {
    const { lobbyId, users } = await makeTable(['Host', 'Bravo', 'Charlie', 'Delta']);
    const [host, bravo, charlie] = users;

    expect((await getLobbyById(lobbyId))?.hostUserId).toBe(host.id);

    await removeSeat(lobbyId, host.id);
    expect((await getLobbyById(lobbyId))?.hostUserId).toBe(bravo.id);

    await removeSeat(lobbyId, bravo.id);
    expect((await getLobbyById(lobbyId))?.hostUserId).toBe(charlie.id);
  });

  it('grants host controls to the new host and revokes them from the old host', async () => {
    const { lobbyId, users } = await makeTable(['Host', 'Bravo']);
    const [host, bravo] = users;

    await removeSeat(lobbyId, host.id);
    expect((await getLobbyById(lobbyId))?.hostUserId).toBe(bravo.id);

    // Old host can no longer perform a host-only action; new host can.
    const oldHostAttempt = await setTableBuyIn(lobbyId, host.id, 100);
    expect(oldHostAttempt).toHaveProperty('error');

    const newHostAttempt = await setTableBuyIn(lobbyId, bravo.id, 100);
    expect(newHostAttempt).not.toHaveProperty('error');
  });

  it('does not let a rejoining ex-host reclaim host status', async () => {
    const { lobbyId, users } = await makeTable(['Host', 'Bravo', 'Charlie']);
    const [host, bravo, charlie] = users;

    await removeSeat(lobbyId, host.id);
    expect((await getLobbyById(lobbyId))?.hostUserId).toBe(bravo.id);

    // Ex-host rejoins — joins a lobby that already has a host, so claim is a no-op.
    await autoSeatPlayer(lobbyId, host.id, host.displayName);
    expect(await claimHostIfVacant(lobbyId, host.id)).toBeNull();
    expect((await getLobbyById(lobbyId))?.hostUserId).toBe(bravo.id);

    // Ex-host now has the latest tenure, so when Bravo leaves, Charlie (not ex-host) inherits.
    const mem = memoryStore.lobbies.get(lobbyId)!;
    mem.seats.find((s) => s.userId === host.id)!.seatedAt = new Date(1_800_000_000_000).toISOString();
    await removeSeat(lobbyId, bravo.id);
    expect((await getLobbyById(lobbyId))?.hostUserId).toBe(charlie.id);
  });

  it('migrates to a sitting-out player when they are the longest-tenured remaining', async () => {
    const { lobbyId, users } = await makeTable(['Host', 'Bravo', 'Charlie']);
    const [host, bravo] = users;

    await setSittingOut(lobbyId, bravo.id, true);
    await removeSeat(lobbyId, host.id);
    expect((await getLobbyById(lobbyId))?.hostUserId).toBe(bravo.id);
  });

  it('leaves an empty table host-less and lets the next joiner claim host', async () => {
    const { lobbyId, users } = await makeTable(['Host']);
    const [host] = users;

    await removeSeat(lobbyId, host.id);
    expect((await getLobbyById(lobbyId))?.hostUserId).toBeNull();

    const newcomer = await guestLogin('Newcomer');
    await autoSeatPlayer(lobbyId, newcomer.id, newcomer.displayName);
    const claimed = await claimHostIfVacant(lobbyId, newcomer.id);
    expect(claimed?.hostUserId).toBe(newcomer.id);
    expect((await getLobbyById(lobbyId))?.hostUserId).toBe(newcomer.id);
  });

  it('reassigns host when the host is kicked', async () => {
    const { lobbyId, users } = await makeTable(['Host', 'Bravo']);
    const [host, bravo] = users;
    const hostSeat = memoryStore.lobbies.get(lobbyId)!.seats.find((s) => s.userId === host.id)!;

    await kickSeat(lobbyId, hostSeat.seatIndex);
    expect((await getLobbyById(lobbyId))?.hostUserId).toBe(bravo.id);
  });
});
