import { describe, it, expect } from 'vitest';
import { TIME_BANK_MAX_USES } from '@vct/shared-types';
import {
  getTimeBankRemaining,
  setTimeBankRemaining,
  clearTimeBankForUser,
  clearTimeBankForLobby,
} from './time-bank.js';

describe('time-bank budgets', () => {
  it('defaults a fresh player to the configured max', () => {
    expect(getTimeBankRemaining('lobby-default', 'user-1')).toBe(TIME_BANK_MAX_USES);
  });

  it('persists a decremented budget per user', () => {
    setTimeBankRemaining('lobby-a', 'user-1', 2);
    expect(getTimeBankRemaining('lobby-a', 'user-1')).toBe(2);
    // a different user in the same lobby is independent
    expect(getTimeBankRemaining('lobby-a', 'user-2')).toBe(TIME_BANK_MAX_USES);
  });

  it('floors the remaining budget at zero', () => {
    setTimeBankRemaining('lobby-b', 'user-1', -5);
    expect(getTimeBankRemaining('lobby-b', 'user-1')).toBe(0);
  });

  it('clearTimeBankForUser resets that player to full', () => {
    setTimeBankRemaining('lobby-c', 'user-1', 0);
    clearTimeBankForUser('lobby-c', 'user-1');
    expect(getTimeBankRemaining('lobby-c', 'user-1')).toBe(TIME_BANK_MAX_USES);
  });

  it('clearTimeBankForLobby resets every player in the lobby', () => {
    setTimeBankRemaining('lobby-d', 'user-1', 1);
    setTimeBankRemaining('lobby-d', 'user-2', 0);
    clearTimeBankForLobby('lobby-d');
    expect(getTimeBankRemaining('lobby-d', 'user-1')).toBe(TIME_BANK_MAX_USES);
    expect(getTimeBankRemaining('lobby-d', 'user-2')).toBe(TIME_BANK_MAX_USES);
  });
});
