import { describe, it, expect } from 'vitest';
import { addChatMessage, addWhisperMessage, getChatHistory } from './chat.js';

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
