import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  addChatMessage,
  addWhisperMessage,
  canSendReaction,
  createReaction,
  getChatHistory,
  REACTION_COOLDOWN_MS,
} from './chat.js';

describe('whisper visibility', () => {
  const lobbyId = 'test-whisper-lobby';

  addChatMessage(lobbyId, 'alice', 'Alice', 'hello table');
  const whisper = addWhisperMessage(lobbyId, 'alice', 'Alice', 'bob', 'Bob', 'nice bluff');

  it('stores whisper metadata', () => {
    expect(whisper.isWhisper).toBe(true);
    expect(whisper.userId).toBe('alice');
    expect(whisper.recipientUserId).toBe('bob');
    expect(whisper.recipientDisplayName).toBe('Bob');
    expect(whisper.text).toBe('nice bluff');
  });

  it('sender sees own whispers in history', () => {
    const history = getChatHistory(lobbyId, 'alice');
    expect(history.map((m) => m.id)).toContain(whisper.id);
  });

  it('recipient sees whispers addressed to them', () => {
    const history = getChatHistory(lobbyId, 'bob');
    expect(history.map((m) => m.id)).toContain(whisper.id);
  });

  it('third parties never see whispers but still see public chat', () => {
    const history = getChatHistory(lobbyId, 'carol');
    expect(history.some((m) => m.isWhisper)).toBe(false);
    expect(history.some((m) => m.text === 'hello table')).toBe(true);
  });

  it('anonymous history replay excludes all whispers', () => {
    const history = getChatHistory(lobbyId);
    expect(history.some((m) => m.isWhisper)).toBe(false);
  });

  it('truncates whisper text to 500 chars', () => {
    const long = addWhisperMessage(lobbyId, 'alice', 'Alice', 'bob', 'Bob', 'x'.repeat(600));
    expect(long.text.length).toBe(500);
  });
});

describe('reaction cooldown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows the first reaction and blocks repeats inside the cooldown window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(canSendReaction('dave')).toBe(true);
    expect(canSendReaction('dave')).toBe(false);
    vi.setSystemTime(1_000_000 + REACTION_COOLDOWN_MS - 1);
    expect(canSendReaction('dave')).toBe(false);
    vi.setSystemTime(1_000_000 + REACTION_COOLDOWN_MS);
    expect(canSendReaction('dave')).toBe(true);
  });

  it('tracks cooldowns per player', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    expect(canSendReaction('erin')).toBe(true);
    expect(canSendReaction('frank')).toBe(true);
    expect(canSendReaction('erin')).toBe(false);
  });
});

describe('createReaction', () => {
  it('builds a reaction event with seat and identity metadata', () => {
    const r = createReaction('alice', 'Alice', '🔥', 3);
    expect(r.userId).toBe('alice');
    expect(r.displayName).toBe('Alice');
    expect(r.emoji).toBe('🔥');
    expect(r.seatIndex).toBe(3);
    expect(r.id).toBeTruthy();
    expect(Date.parse(r.timestamp)).not.toBeNaN();
  });

  it('uses a null seat for spectators', () => {
    const r = createReaction('spec', 'Spec', '👏', null);
    expect(r.seatIndex).toBeNull();
  });

  it('never enters chat history (reactions are transient)', () => {
    createReaction('alice', 'Alice', '🎉', 1);
    const history = getChatHistory('test-whisper-lobby');
    expect(history.some((m) => m.text === '🎉')).toBe(false);
  });
});
