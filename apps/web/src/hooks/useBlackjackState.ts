import { useCallback, useState } from 'react';
import type {
  BlackjackLegalAction,
  BlackjackRoundPlayerResult,
  PublicBlackjackState,
  ServerMessage,
} from '@vct/shared-types';

export interface BlackjackStateHook {
  bjState: PublicBlackjackState | null;
  bjLegalActions: BlackjackLegalAction[];
  bjRoundResults: BlackjackRoundPlayerResult[] | null;
  handleBjMessage: (msg: ServerMessage) => boolean;
  clearBjRoundResults: () => void;
}

export function useBlackjackState(): BlackjackStateHook {
  const [bjState, setBjState] = useState<PublicBlackjackState | null>(null);
  const [bjLegalActions, setBjLegalActions] = useState<BlackjackLegalAction[]>([]);
  const [bjRoundResults, setBjRoundResults] = useState<BlackjackRoundPlayerResult[] | null>(null);

  const handleBjMessage = useCallback((msg: ServerMessage): boolean => {
    switch (msg.type) {
      case 'bj_state':
        setBjState(msg.state);
        setBjLegalActions(msg.legalActions ?? []);
        return true;

      case 'bj_round_started':
        // State update comes via bj_state
        return true;

      case 'bj_player_acted':
        setBjState(msg.state);
        setBjLegalActions(msg.legalActions ?? []);
        return true;

      case 'bj_dealer_acted':
        setBjState(msg.state);
        return true;

      case 'bj_round_settled':
        setBjState(msg.state);
        setBjLegalActions([]);
        setBjRoundResults(msg.results);
        return true;

      case 'bj_bet_placed':
        // Handled by bj_state that follows
        return true;

      default:
        return false;
    }
  }, []);

  const clearBjRoundResults = useCallback(() => setBjRoundResults(null), []);

  return { bjState, bjLegalActions, bjRoundResults, handleBjMessage, clearBjRoundResults };
}
