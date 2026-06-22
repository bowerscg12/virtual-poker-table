/**
 * Blackjack-specific WebSocket message handling.
 * Imported by handler.ts and called for bj_* messages and blackjack lobby lifecycle.
 */
import type { WebSocket } from 'ws';
import type { AvatarConfig, BlackjackSessionRecap, ClientMessage, LobbySummary, ServerMessage, VariantConfig } from '@vct/shared-types';
import { getTableBuyIn } from '@vct/shared-types';
import {
  getLegalActions as getBjLegalActionsEngine,
  blackjackRulesFromConfig,
  decideBlackjackAction,
} from '@vct/blackjack-engine';
import {
  applyBjAction,
  autoStandBjPlayer,
  bjInsuranceComplete,
  clearBjBet,
  clearBjRoundNumber,
  clearBjState,
  getBjLegalActions,
  getBjState,
  persistBjState,
  placeBjBet,
  placeBjInsurance,
  resolveBjInsurance,
  settleBjRound,
  startBjRound,
  takeBjEvenMoney,
  toPublicBjState,
  closeBjBetting,
  stepBjDealer,
  removeBjPlayer,
} from '../services/blackjack-manager.js';
import { getActiveLobbyIds, getLobbyById, rebuyPlayer, updateLobbyStatus } from '../services/lobby.js';
import { initSession } from '../services/session-stats.js';
import { isBotUser, registerLobbyBots } from '../services/bots.js';
import {
  clearBjRunForUser,
  clearLobbyBjRuns,
  ensureBjRun,
  getBjRun,
  recordBjRoundForRuns,
  resetBjRun,
} from '../services/blackjack-session.js';
import { recordBjHighScore } from '../services/blackjack-highscore.js';

// ── Timer maps ────────────────────────────────────────────────────────────────

/** lobbyId → betting-phase countdown (fires to close betting and deal) */
const bjBetTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bjBetTimerGenerations = new Map<string, number>();

/** lobbyId → insurance-window countdown (fires to peek the hole card and begin play) */
const bjInsuranceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bjInsuranceTimerGenerations = new Map<string, number>();

/** lobbyId → action-turn countdown (fires to auto-stand the acting player) */
const bjActionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bjActionTimerGenerations = new Map<string, number>();

/** lobbyId → between-round countdown (fires to start next round's betting phase) */
const bjIntermissionTimers = new Map<string, ReturnType<typeof setTimeout>>();
const bjIntermissionTimerGenerations = new Map<string, number>();
/** lobbyId → Unix ms deadline of the running intermission (for pause/resume bookkeeping). */
const bjIntermissionDeadlines = new Map<string, number>();

/** lobbyId → frozen pause snapshot (phase + remaining ms) so resume can continue accurately. */
const bjPauseSnapshots = new Map<string, { phase: string; remainingMs: number }>();

const BJ_BETTING_MS = 10_000;
const BJ_INSURANCE_MS = 15_000;
const BJ_INTERMISSION_MS = 10_000;
const BJ_DEALER_STEP_MS = 1_000;
/** A bot's simulated "thinking" delay before it bets or acts. */
const BJ_BOT_THINK_MS = 1_400;

// ── Helpers shared with handler.ts ───────────────────────────────────────────

type SendFn = (ws: WebSocket, msg: ServerMessage) => void;
type BroadcastFn = (lobbyId: string, build: (userId: string | null, isSpec: boolean) => ServerMessage) => void;
type GetConnectedFn = (lobbyId: string) => Set<string>;
type SendToUserFn = (userId: string, msg: ServerMessage) => void;

export interface BjHandlerDeps {
  send: SendFn;
  broadcastLobby: BroadcastFn;
  getConnectedSet: GetConnectedFn;
  sendToUser: SendToUserFn;
}

/** Guards against two near-simultaneous "play again" rebuys both reviving an idle table. */
const bjRoundStarting = new Set<string>();

function actionTimerMs(config: VariantConfig): number {
  return (config.actionTimerSec ?? 0) * 1000;
}

// ── Lobby metadata helpers ────────────────────────────────────────────────────

function displayNameMap(lobby: LobbySummary): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of lobby.seats) {
    if (s.userId && s.displayName) m.set(s.userId, s.displayName);
  }
  return m;
}

function avatarMap(lobby: LobbySummary): Map<string, AvatarConfig | undefined> {
  const m = new Map<string, AvatarConfig | undefined>();
  for (const s of lobby.seats) {
    if (s.userId) m.set(s.userId, s.avatar ?? undefined);
  }
  return m;
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────

async function broadcastBjState(
  lobbyId: string,
  deps: BjHandlerDeps,
  intermissionDeadline?: string,
): Promise<void> {
  const [state, lobby] = await Promise.all([getBjState(lobbyId), getLobbyById(lobbyId)]);
  if (!state || !lobby) return;

  const names = displayNameMap(lobby);
  const avatars = avatarMap(lobby);
  const pub = toPublicBjState(state, names, avatars, intermissionDeadline);
  const rules = blackjackRulesFromConfig(lobby.settings);

  deps.broadcastLobby(lobbyId, (userId) => {
    const activePlayer = state.players[state.activePlayerIndex];
    const actions = (userId && state.phase === 'player_turn' && activePlayer?.userId === userId)
      ? getBjLegalActionsEngine(state, userId, rules)
      : [];
    return { type: 'bj_state', state: pub, legalActions: actions.length ? actions : undefined };
  });
}

// ── Betting phase ─────────────────────────────────────────────────────────────

export async function startBjBettingPhase(
  lobbyId: string,
  config: VariantConfig,
  lobby: LobbySummary,
  deps: BjHandlerDeps,
  _isFirstStart: boolean,
): Promise<void> {
  // Only players who can still cover the table minimum participate; the rest have busted out
  // (high-score mode) and wait on the recap screen for a fresh buy-in.
  const minBet = config.blackjackMinBet ?? 5;
  const buyIn = getTableBuyIn(config);
  const activePlayers = lobby.seats
    .filter((s) => s.userId && s.stack >= minBet)
    .map((s) => ({ userId: s.userId!, seatIndex: s.seatIndex, stack: s.stack }));

  if (activePlayers.length === 0) return;

  // Keep the bot-id cache warm (survives restarts) so isBotUser() recognises seated bots.
  registerLobbyBots(lobby);

  // Restart-safe round numbering: derive from the persisted prior round, not an in-memory counter.
  const prev = await getBjState(lobbyId);
  const roundNumber = (prev?.roundNumber ?? 0) + 1;

  // Ensure every participant has a stats accumulator + an active high-score run.
  for (const p of activePlayers) {
    const seat = lobby.seats.find((s) => s.userId === p.userId);
    initSession(lobbyId, p.userId, seat?.displayName ?? 'Player', p.stack);
    ensureBjRun(lobbyId, p.userId, p.stack, buyIn);
  }

  const state = await startBjRound(lobbyId, config, activePlayers, roundNumber);

  const deadline = Date.now() + BJ_BETTING_MS;
  await persistBjState(lobbyId, { ...state, betDeadline: deadline });

  console.log(`[bj] Round ${roundNumber} betting phase started for lobby ${lobbyId}`);

  deps.broadcastLobby(lobbyId, () => ({ type: 'bj_round_started', deadline }));
  await broadcastBjState(lobbyId, deps);

  scheduleBjBetTimer(lobbyId, config, deps, BJ_BETTING_MS);

  // Bots place their bets right away (after a short think) so the table fills out.
  await placeBjBotBets(lobbyId, config, lobby, deps);
}

/** Bot bet sizing: two minimum bets, clamped to the table max and the bot's stack. */
function botBetAmount(config: VariantConfig, stack: number): number {
  const min = config.blackjackMinBet ?? 5;
  const max = config.blackjackMaxBet ?? 500;
  return Math.max(min, Math.min(min * 2, max, stack));
}

/** Place automatic bets for every seated bot in the current betting phase. */
async function placeBjBotBets(
  lobbyId: string,
  config: VariantConfig,
  lobby: LobbySummary,
  deps: BjHandlerDeps,
): Promise<void> {
  const bots = lobby.seats.filter((s) => s.userId && s.isBot && s.stack > 0);
  for (const seat of bots) {
    const amount = botBetAmount(config, seat.stack);
    const result = await placeBjBet(lobbyId, seat.userId!, amount, config);
    if ('error' in result) continue;
    deps.broadcastLobby(lobbyId, () => ({ type: 'bj_bet_placed', seatIndex: seat.seatIndex, amount }));
  }
  if (bots.length > 0) await broadcastBjState(lobbyId, deps);
}

function scheduleBjBetTimer(lobbyId: string, config: VariantConfig, deps: BjHandlerDeps, ms: number): void {
  cancelBjBetTimer(lobbyId);
  const gen = (bjBetTimerGenerations.get(lobbyId) ?? 0) + 1;
  bjBetTimerGenerations.set(lobbyId, gen);
  bjBetTimers.set(lobbyId, setTimeout(() => {
    if ((bjBetTimerGenerations.get(lobbyId) ?? 0) !== gen) return;
    bjBetTimers.delete(lobbyId);
    dealAndStartPlayerTurn(lobbyId, config, deps).catch(() => {});
  }, ms));
}

function cancelBjBetTimer(lobbyId: string): void {
  const t = bjBetTimers.get(lobbyId);
  if (t) { clearTimeout(t); bjBetTimers.delete(lobbyId); }
  bjBetTimerGenerations.set(lobbyId, (bjBetTimerGenerations.get(lobbyId) ?? 0) + 1);
}

async function dealAndStartPlayerTurn(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  const result = await closeBjBetting(lobbyId, config);
  if ('error' in result) {
    console.warn(`[bj] closeBjBetting failed for ${lobbyId}: ${result.error}`);
    scheduleBjIntermission(lobbyId, config, deps);
    return;
  }

  if (result.phase === 'insurance') {
    await startInsuranceWindow(lobbyId, config, deps);
    return;
  }

  await routeDealtState(lobbyId, config, deps);
}

// ── Insurance window ────────────────────────────────────────────────────────────

async function startInsuranceWindow(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  const state = await getBjState(lobbyId);
  if (!state) return;
  const deadline = Date.now() + BJ_INSURANCE_MS;
  await persistBjState(lobbyId, { ...state, insuranceDeadline: deadline });

  const lobby = await getLobbyById(lobbyId);
  if (lobby) {
    const pub = toPublicBjState(await getBjState(lobbyId) ?? state, displayNameMap(lobby), avatarMap(lobby));
    deps.broadcastLobby(lobbyId, () => ({ type: 'bj_insurance_prompt', deadline, state: pub }));
  }
  await broadcastBjState(lobbyId, deps);

  scheduleBjInsuranceTimer(lobbyId, config, deps, BJ_INSURANCE_MS);

  // Basic strategy never takes insurance — bots decline immediately.
  const lobbyForBots = await getLobbyById(lobbyId);
  if (lobbyForBots) {
    let declined = false;
    for (const seat of lobbyForBots.seats) {
      if (seat.userId && seat.isBot) {
        const r = await placeBjInsurance(lobbyId, seat.userId, 0);
        if (!('error' in r)) declined = true;
      }
    }
    if (declined) await broadcastBjState(lobbyId, deps);
    if (await bjInsuranceComplete(lobbyId)) await closeInsuranceWindow(lobbyId, config, deps);
  }
}

function scheduleBjInsuranceTimer(lobbyId: string, config: VariantConfig, deps: BjHandlerDeps, ms: number): void {
  cancelBjInsuranceTimer(lobbyId);
  const gen = (bjInsuranceTimerGenerations.get(lobbyId) ?? 0) + 1;
  bjInsuranceTimerGenerations.set(lobbyId, gen);
  bjInsuranceTimers.set(lobbyId, setTimeout(() => {
    if ((bjInsuranceTimerGenerations.get(lobbyId) ?? 0) !== gen) return;
    bjInsuranceTimers.delete(lobbyId);
    closeInsuranceWindow(lobbyId, config, deps).catch(() => {});
  }, ms));
}

function cancelBjInsuranceTimer(lobbyId: string): void {
  const t = bjInsuranceTimers.get(lobbyId);
  if (t) { clearTimeout(t); bjInsuranceTimers.delete(lobbyId); }
  bjInsuranceTimerGenerations.set(lobbyId, (bjInsuranceTimerGenerations.get(lobbyId) ?? 0) + 1);
}

async function closeInsuranceWindow(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  cancelBjInsuranceTimer(lobbyId);
  const resolved = await resolveBjInsurance(lobbyId);
  if ('error' in resolved) return;
  await routeDealtState(lobbyId, config, deps);
}

// ── Player turn routing ──────────────────────────────────────────────────────────

/**
 * Route a freshly dealt / post-insurance state: settle via the dealer when no player acts,
 * otherwise set the action deadline, broadcast, and arm the turn timer.
 */
async function routeDealtState(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  const state = await getBjState(lobbyId);
  if (!state) return;

  if (state.phase === 'dealer_turn') {
    await broadcastBjState(lobbyId, deps);
    await runBjDealerSequence(lobbyId, config, deps);
    return;
  }

  // player_turn — bots act on their own clock; humans get a countdown deadline + timer.
  const active = state.players[state.activePlayerIndex];
  const isBot = active ? isBotUser(active.userId) : false;
  const ms = actionTimerMs(config);
  const deadline = !isBot && ms > 0 ? Date.now() + ms : undefined;
  await persistBjState(lobbyId, { ...state, actionDeadline: deadline, insuranceDeadline: undefined });
  await broadcastBjState(lobbyId, deps);

  if (isBot) {
    scheduleBjBotTurn(lobbyId, config, deps);
  } else if (ms > 0) {
    scheduleBjActionTimer(lobbyId, config, deps, ms);
  }
}

/**
 * Schedule a bot's turn. Uses the action-timer slot so a human kick / disconnect / new round
 * cancels it cleanly (mutual exclusion with the human action timer).
 */
function scheduleBjBotTurn(lobbyId: string, config: VariantConfig, deps: BjHandlerDeps): void {
  cancelBjActionTimer(lobbyId);
  const gen = (bjActionTimerGenerations.get(lobbyId) ?? 0) + 1;
  bjActionTimerGenerations.set(lobbyId, gen);

  bjActionTimers.set(lobbyId, setTimeout(async () => {
    if ((bjActionTimerGenerations.get(lobbyId) ?? 0) !== gen) return;
    bjActionTimers.delete(lobbyId);

    const state = await getBjState(lobbyId);
    if (!state || state.phase !== 'player_turn') return;
    const player = state.players[state.activePlayerIndex];
    if (!player || !isBotUser(player.userId)) return;
    const hand = player.hands[player.activeHandIndex];
    if (!hand) return;

    const rules = blackjackRulesFromConfig(config);
    const legal = getBjLegalActionsEngine(state, player.userId, rules);
    let action = decideBlackjackAction(hand.cards, state.dealer.cards[0]!, {
      canDouble: legal.some((a) => a.type === 'double_down'),
      canSplit: legal.some((a) => a.type === 'split'),
      canSurrender: legal.some((a) => a.type === 'surrender'),
    });
    // Safety: never send an action that isn't currently legal (hit/stand always are).
    if (!legal.some((a) => a.type === action)) action = 'stand';

    const newHandId = action === 'split' ? crypto.randomUUID() : undefined;
    const result = await applyBjAction(lobbyId, player.userId, action, hand.id, config, newHandId);
    if ('error' in result) {
      // Fall back to a stand so the table can never stall on a bot.
      await applyBjAction(lobbyId, player.userId, 'stand', hand.id, config);
    }

    const lobby = await getLobbyById(lobbyId);
    const latest = await getBjState(lobbyId);
    if (lobby && latest) {
      const pub = toPublicBjState(latest, displayNameMap(lobby), avatarMap(lobby));
      deps.broadcastLobby(lobbyId, () => ({
        type: 'bj_player_acted',
        seatIndex: player.seatIndex,
        action: `bj_${action}`,
        state: pub,
      }));
    }

    await routeDealtState(lobbyId, config, deps);
  }, BJ_BOT_THINK_MS));
}

function scheduleBjActionTimer(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
  ms: number,
): void {
  cancelBjActionTimer(lobbyId);
  const gen = (bjActionTimerGenerations.get(lobbyId) ?? 0) + 1;
  bjActionTimerGenerations.set(lobbyId, gen);

  bjActionTimers.set(lobbyId, setTimeout(async () => {
    if ((bjActionTimerGenerations.get(lobbyId) ?? 0) !== gen) return;
    bjActionTimers.delete(lobbyId);

    const state = await getBjState(lobbyId);
    if (!state || state.phase !== 'player_turn') return;
    const player = state.players[state.activePlayerIndex];
    if (!player) return;

    const result = await autoStandBjPlayer(lobbyId, player.userId);
    if (!result) return;

    await routeDealtState(lobbyId, config, deps);
  }, ms));
}

function cancelBjActionTimer(lobbyId: string): void {
  const t = bjActionTimers.get(lobbyId);
  if (t) { clearTimeout(t); bjActionTimers.delete(lobbyId); }
  bjActionTimerGenerations.set(lobbyId, (bjActionTimerGenerations.get(lobbyId) ?? 0) + 1);
}

// ── Dealer sequence ────────────────────────────────────────────────────────────

async function runBjDealerSequence(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  let keepGoing = true;
  while (keepGoing) {
    const stepResult = await stepBjDealer(lobbyId, config);
    if ('error' in stepResult) break;
    keepGoing = stepResult.drew;

    if (stepResult.drew) {
      const state = stepResult.state;
      const lobby = await getLobbyById(lobbyId);
      if (lobby) {
        const pub = toPublicBjState(state, displayNameMap(lobby), avatarMap(lobby));
        deps.broadcastLobby(lobbyId, () => ({ type: 'bj_dealer_acted', state: pub }));
      }
      await delay(BJ_DEALER_STEP_MS);
    }
  }

  const lobby = await getLobbyById(lobbyId);
  if (!lobby) return;

  const settled = await settleBjRound(lobbyId, displayNameMap(lobby), config);
  if ('error' in settled) return;

  // High-score bookkeeping: fold the round into each run, then persist every participating
  // player's personal bests (so stats accrue even without busting) and send a recap to busts.
  const minBet = config.blackjackMinBet ?? 5;
  const busts = recordBjRoundForRuns(lobbyId, settled.state.players, minBet);
  const bustsById = new Map(busts.map((b) => [b.userId, b]));
  for (const player of settled.state.players) {
    if (player.status === 'sitting_out') continue;
    const run = getBjRun(lobbyId, player.userId);
    if (!run) continue;
    const best = await recordBjHighScore(player.userId, {
      peakChips: run.peakChips,
      handsWon: run.handsWon,
      longestWinStreak: run.longestWinStreak,
      runHands: run.roundsPlayed,
      biggestHandWin: run.biggestHandWin,
    });
    const bust = bustsById.get(player.userId);
    if (bust) {
      deps.sendToUser(bust.userId, {
        type: 'bj_session_recap',
        recap: {
          buyIn: bust.buyIn,
          peakChips: bust.peakChips,
          handsWon: bust.handsWon,
          handsPlayed: bust.handsPlayed,
          bestPeak: best.bestPeak,
          bestHandsWon: best.bestHandsWon,
          isPeakRecord: best.isPeakRecord,
          isHandsRecord: best.isHandsRecord,
        },
      });
    }
  }

  const intermissionDeadlineMs = Date.now() + BJ_INTERMISSION_MS;
  const intermissionDeadline = new Date(intermissionDeadlineMs).toISOString();
  const pub = toPublicBjState(settled.state, displayNameMap(lobby), avatarMap(lobby), intermissionDeadline);

  deps.broadcastLobby(lobbyId, () => ({
    type: 'bj_round_settled',
    state: pub,
    results: settled.results,
  }));

  scheduleBjIntermission(lobbyId, config, deps);
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ── Intermission ───────────────────────────────────────────────────────────────

function scheduleBjIntermission(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
  ms: number = BJ_INTERMISSION_MS,
): void {
  cancelBjIntermissionTimer(lobbyId);
  const gen = (bjIntermissionTimerGenerations.get(lobbyId) ?? 0) + 1;
  bjIntermissionTimerGenerations.set(lobbyId, gen);
  bjIntermissionDeadlines.set(lobbyId, Date.now() + ms);

  bjIntermissionTimers.set(lobbyId, setTimeout(async () => {
    if ((bjIntermissionTimerGenerations.get(lobbyId) ?? 0) !== gen) return;
    bjIntermissionTimers.delete(lobbyId);
    bjIntermissionDeadlines.delete(lobbyId);
    await onBjIntermissionExpired(lobbyId, config, deps);
  }, ms));
}

function cancelBjIntermissionTimer(lobbyId: string): void {
  const t = bjIntermissionTimers.get(lobbyId);
  if (t) { clearTimeout(t); bjIntermissionTimers.delete(lobbyId); }
  bjIntermissionTimerGenerations.set(lobbyId, (bjIntermissionTimerGenerations.get(lobbyId) ?? 0) + 1);
  bjIntermissionDeadlines.delete(lobbyId);
}

async function onBjIntermissionExpired(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  const lobby = await getLobbyById(lobbyId);
  if (!lobby || lobby.status !== 'playing') return;

  await startBjBettingPhase(lobbyId, config, lobby, deps, false);
}

// ── Reconnect / join ──────────────────────────────────────────────────────────

/**
 * Send the current blackjack state to a single client (reconnect or join).
 */
export async function sendBjStateToClient(
  ws: WebSocket,
  lobbyId: string,
  userId: string,
  deps: BjHandlerDeps,
): Promise<void> {
  const [state, lobby] = await Promise.all([getBjState(lobbyId), getLobbyById(lobbyId)]);
  if (!state || !lobby) return;

  const names = displayNameMap(lobby);
  const avatars = avatarMap(lobby);
  const intermissionDeadline = bjIntermissionDeadlines.has(lobbyId)
    ? new Date(bjIntermissionDeadlines.get(lobbyId)!).toISOString()
    : undefined;
  const pub = toPublicBjState(state, names, avatars, intermissionDeadline);

  const legalActions = state.phase === 'player_turn'
    ? await getBjLegalActions(lobbyId, userId, lobby.settings)
    : [];

  deps.send(ws, {
    type: 'bj_state',
    state: pub,
    legalActions: legalActions.length ? legalActions : undefined,
  });

  // Re-surface the insurance prompt if the window is still open for this player.
  if (state.phase === 'insurance' && state.insuranceDeadline) {
    deps.send(ws, { type: 'bj_insurance_prompt', deadline: state.insuranceDeadline, state: pub });
  }
}

// ── Message handler ────────────────────────────────────────────────────────────

/**
 * Handle a blackjack-specific client message.
 * Returns true if the message was handled (so handler.ts can skip the default error).
 */
export async function handleBjMessage(
  ws: WebSocket,
  msg: ClientMessage,
  userId: string,
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<boolean> {
  switch (msg.type) {
    case 'bj_place_bet': {
      const result = await placeBjBet(lobbyId, userId, msg.amount, config);
      if ('error' in result) {
        deps.send(ws, { type: 'error', message: result.error });
        return true;
      }
      const lobby = await getLobbyById(lobbyId);
      if (lobby) {
        const pub = toPublicBjState(result, displayNameMap(lobby), avatarMap(lobby));
        const seatIndex = result.players.find((p) => p.userId === userId)?.seatIndex ?? -1;
        deps.broadcastLobby(lobbyId, () => ({ type: 'bj_bet_placed', seatIndex, amount: msg.amount }));
        deps.broadcastLobby(lobbyId, () => ({ type: 'bj_state', state: pub }));
      }
      return true;
    }

    case 'bj_clear_bet': {
      const result = await clearBjBet(lobbyId, userId);
      if ('error' in result) {
        deps.send(ws, { type: 'error', message: result.error });
        return true;
      }
      await broadcastBjState(lobbyId, deps);
      return true;
    }

    case 'bj_insurance': {
      const result = await placeBjInsurance(lobbyId, userId, msg.amount);
      if ('error' in result) {
        deps.send(ws, { type: 'error', message: result.error });
        return true;
      }
      await broadcastBjState(lobbyId, deps);
      if (await bjInsuranceComplete(lobbyId)) {
        await closeInsuranceWindow(lobbyId, config, deps);
      }
      return true;
    }

    case 'bj_even_money': {
      const result = await takeBjEvenMoney(lobbyId, userId);
      if ('error' in result) {
        deps.send(ws, { type: 'error', message: result.error });
        return true;
      }
      await broadcastBjState(lobbyId, deps);
      if (await bjInsuranceComplete(lobbyId)) {
        await closeInsuranceWindow(lobbyId, config, deps);
      }
      return true;
    }

    case 'bj_hit':
    case 'bj_stand':
    case 'bj_double_down':
    case 'bj_split':
    case 'bj_surrender': {
      const actionMap = {
        bj_hit: 'hit',
        bj_stand: 'stand',
        bj_double_down: 'double_down',
        bj_split: 'split',
        bj_surrender: 'surrender',
      } as const;
      const action = actionMap[msg.type];
      const newHandId = action === 'split' ? crypto.randomUUID() : undefined;

      cancelBjActionTimer(lobbyId);

      const result = await applyBjAction(lobbyId, userId, action, msg.handId, config, newHandId);
      if ('error' in result) {
        deps.send(ws, { type: 'error', message: result.error });
        // Re-arm the timer for the same player after an illegal action.
        await routeDealtState(lobbyId, config, deps);
        return true;
      }

      const lobby = await getLobbyById(lobbyId);
      if (!lobby) return true;

      const pub = toPublicBjState(result, displayNameMap(lobby), avatarMap(lobby));
      const seatIndex = result.players.find((p) => p.userId === userId)?.seatIndex ?? -1;
      // Action feedback (animation/sound) for everyone.
      deps.broadcastLobby(lobbyId, () => ({ type: 'bj_player_acted', seatIndex, action: msg.type, state: pub }));

      // Continue routing (sets the next player's deadline / arms timer / runs the dealer).
      await routeDealtState(lobbyId, config, deps);
      return true;
    }

    case 'bj_play_again': {
      const buyIn = getTableBuyIn(config);
      const updated = await rebuyPlayer(lobbyId, userId, buyIn);
      resetBjRun(lobbyId, userId, buyIn);
      if (updated) deps.broadcastLobby(lobbyId, () => ({ type: 'lobby_state', lobby: updated }));
      // If the table went idle because everyone had busted, revive the betting loop.
      await ensureBjRunning(lobbyId, config, deps);
      await broadcastBjState(lobbyId, deps);
      return true;
    }

    default:
      return false;
  }
}

/**
 * Cash a player out of the blackjack table. Only valid between hands (betting phase or the
 * post-round intermission). Folds the run into the player's personal bests, removes them from
 * the live state, broadcasts the updated table to everyone else, and returns the end-of-run
 * recap (flagged as a cash-out). The caller (handler.ts) frees the seat + reconnect session.
 */
export async function cashOutBjPlayer(
  lobbyId: string,
  userId: string,
  deps: BjHandlerDeps,
): Promise<{ recap: BlackjackSessionRecap } | { error: string }> {
  const state = await getBjState(lobbyId);
  if (!state) return { error: 'No active game to cash out from' };
  if (state.phase !== 'waiting_for_bets' && state.phase !== 'round_complete') {
    return { error: 'You can only cash out between hands' };
  }
  const player = state.players.find((p) => p.userId === userId);
  if (!player) return { error: 'Not seated at this table' };

  // Between hands, the live stack already reflects any settled bets, and a staged-but-undealt
  // bet (pendingBet) is never deducted — so the walk-away amount is simply the current stack.
  const finalStack = player.stack;

  // Fold the run into the player's persistent personal bests before discarding it.
  const run = getBjRun(lobbyId, userId);
  const best = run
    ? await recordBjHighScore(userId, {
        peakChips: run.peakChips,
        handsWon: run.handsWon,
        longestWinStreak: run.longestWinStreak,
        runHands: run.roundsPlayed,
        biggestHandWin: run.biggestHandWin,
      })
    : { bestPeak: finalStack, bestHandsWon: 0, isPeakRecord: false, isHandsRecord: false };

  const recap: BlackjackSessionRecap = {
    buyIn: run?.buyIn ?? finalStack,
    peakChips: run?.peakChips ?? finalStack,
    handsWon: run?.handsWon ?? 0,
    handsPlayed: run?.handsPlayed ?? 0,
    bestPeak: best.bestPeak,
    bestHandsWon: best.bestHandsWon,
    isPeakRecord: best.isPeakRecord,
    isHandsRecord: best.isHandsRecord,
    cashedOut: true,
    finalStack,
  };

  await removeBjPlayer(lobbyId, userId);
  clearBjRunForUser(lobbyId, userId);
  await broadcastBjState(lobbyId, deps);

  return { recap };
}

/** True while any blackjack timer is pending for this lobby (betting loop is alive). */
function isBjLoopActive(lobbyId: string): boolean {
  return (
    bjBetTimers.has(lobbyId) ||
    bjInsuranceTimers.has(lobbyId) ||
    bjActionTimers.has(lobbyId) ||
    bjIntermissionTimers.has(lobbyId)
  );
}

/**
 * Restart the betting loop if it has gone idle (e.g. every player busted out). No-op while a round
 * or countdown is still in progress — those paths schedule the next round themselves.
 */
async function ensureBjRunning(lobbyId: string, config: VariantConfig, deps: BjHandlerDeps): Promise<void> {
  if (isBjLoopActive(lobbyId) || bjRoundStarting.has(lobbyId)) return;
  const state = await getBjState(lobbyId);
  // Only revive between rounds — never interrupt an in-progress hand/dealer sequence.
  if (state && state.phase !== 'round_complete' && state.phase !== 'settlement') return;
  const lobby = await getLobbyById(lobbyId);
  if (!lobby || lobby.status !== 'playing') return;

  bjRoundStarting.add(lobbyId);
  try {
    await startBjBettingPhase(lobbyId, config, lobby, deps, false);
  } finally {
    bjRoundStarting.delete(lobbyId);
  }
}

// ── Host controls: pause / resume ────────────────────────────────────────────────

/** Freeze all blackjack timers, recording the remaining duration so resume can continue. */
export async function pauseBjLobby(lobbyId: string): Promise<void> {
  const state = await getBjState(lobbyId);
  const now = Date.now();
  let snapshot: { phase: string; remainingMs: number } | null = null;

  if (state?.phase === 'waiting_for_bets' && state.betDeadline) {
    snapshot = { phase: 'waiting_for_bets', remainingMs: Math.max(0, state.betDeadline - now) };
  } else if (state?.phase === 'insurance' && state.insuranceDeadline) {
    snapshot = { phase: 'insurance', remainingMs: Math.max(0, state.insuranceDeadline - now) };
  } else if (state?.phase === 'player_turn' && state.actionDeadline) {
    snapshot = { phase: 'player_turn', remainingMs: Math.max(0, state.actionDeadline - now) };
  } else if (bjIntermissionDeadlines.has(lobbyId)) {
    snapshot = { phase: 'intermission', remainingMs: Math.max(0, bjIntermissionDeadlines.get(lobbyId)! - now) };
  }

  if (snapshot) bjPauseSnapshots.set(lobbyId, snapshot);
  else bjPauseSnapshots.delete(lobbyId);

  cancelAllBjTimers(lobbyId);
  await updateLobbyStatus(lobbyId, 'paused');
}

/** Resume blackjack timers from their frozen remaining durations. */
export async function resumeBjLobby(
  lobbyId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  await updateLobbyStatus(lobbyId, 'playing');
  const snap = bjPauseSnapshots.get(lobbyId);
  bjPauseSnapshots.delete(lobbyId);

  const state = await getBjState(lobbyId);
  const now = Date.now();

  if (!snap || !state) {
    // No frozen timer (e.g. paused mid dealer turn or with no round) — start the next round.
    const lobby = await getLobbyById(lobbyId);
    if (lobby && lobby.status === 'playing' && (!state || state.phase === 'round_complete' || state.phase === 'settlement')) {
      await startBjBettingPhase(lobbyId, config, lobby, deps, false);
    }
    return;
  }

  switch (snap.phase) {
    case 'waiting_for_bets':
      await persistBjState(lobbyId, { ...state, betDeadline: now + snap.remainingMs });
      scheduleBjBetTimer(lobbyId, config, deps, snap.remainingMs);
      break;
    case 'insurance':
      await persistBjState(lobbyId, { ...state, insuranceDeadline: now + snap.remainingMs });
      scheduleBjInsuranceTimer(lobbyId, config, deps, snap.remainingMs);
      break;
    case 'player_turn':
      await persistBjState(lobbyId, { ...state, actionDeadline: now + snap.remainingMs });
      if (actionTimerMs(config) > 0) scheduleBjActionTimer(lobbyId, config, deps, snap.remainingMs);
      break;
    case 'intermission':
      scheduleBjIntermission(lobbyId, config, deps, snap.remainingMs);
      break;
  }
  await broadcastBjState(lobbyId, deps);
}

/**
 * Auto-stand a player who is on the clock (disconnect grace expiry or host kick) and continue play.
 * No-op if it isn't that player's turn.
 */
export async function bjAutoActAndAdvance(
  lobbyId: string,
  userId: string,
  config: VariantConfig,
  deps: BjHandlerDeps,
): Promise<void> {
  const state = await getBjState(lobbyId);
  if (!state || state.phase !== 'player_turn') return;
  const active = state.players[state.activePlayerIndex];
  if (!active || active.userId !== userId) return;

  cancelBjActionTimer(lobbyId);
  const result = await autoStandBjPlayer(lobbyId, userId);
  if (!result) return;
  await routeDealtState(lobbyId, config, deps);
}

// ── Cleanup / recovery ───────────────────────────────────────────────────────────

export function cancelAllBjTimers(lobbyId: string): void {
  cancelBjBetTimer(lobbyId);
  cancelBjInsuranceTimer(lobbyId);
  cancelBjActionTimer(lobbyId);
  cancelBjIntermissionTimer(lobbyId);
}

export async function teardownBjLobby(lobbyId: string): Promise<void> {
  cancelAllBjTimers(lobbyId);
  bjPauseSnapshots.delete(lobbyId);
  bjRoundStarting.delete(lobbyId);
  clearLobbyBjRuns(lobbyId);
  await clearBjState(lobbyId);
  clearBjRoundNumber(lobbyId);
}

/**
 * Recover blackjack tables after a server restart: any persisted round is mid-flight with no timers,
 * so discard it and reopen a fresh betting phase from the lobby's (pre-round) seat stacks. Bets are
 * only deducted in the volatile round state, so no chips are lost.
 */
export async function recoverBlackjackLobbies(deps: BjHandlerDeps): Promise<void> {
  let lobbyIds: string[];
  try {
    lobbyIds = await getActiveLobbyIds();
  } catch {
    return;
  }
  for (const lobbyId of lobbyIds) {
    try {
      const lobby = await getLobbyById(lobbyId);
      if (!lobby || lobby.settings.game !== 'blackjack' || lobby.status !== 'playing') continue;
      cancelAllBjTimers(lobbyId);
      await clearBjState(lobbyId);
      await startBjBettingPhase(lobbyId, lobby.settings, lobby, deps, false);
      console.log(`[bj] Recovered lobby ${lobbyId} — reopened betting`);
    } catch (err) {
      console.error(`[bj] Recovery failed for ${lobbyId}:`, err);
    }
  }
}
