export interface BlindLevel {
  level: number;
  small: number;
  big: number;
  durationMinutes: number;
}

export interface TournamentSettings {
  variant: 'holdem' | 'omaha';
  buyIn: number;
  startingStack: number;
  numTables: number;
  seatsPerTable: number;
  scheduledStart: string;
  blindSchedule: BlindLevel[];
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  /** null when eliminated */
  stack: number | null;
  tableNumber: number | null;
  bustPosition: number | null;
  prizeAwarded: number | null;
  isEliminated: boolean;
}

export interface PublicTournamentState {
  id: string;
  inviteCode: string;
  status: 'waiting' | 'running' | 'finished' | 'cancelled';
  variant: string;
  buyIn: number;
  startingStack: number;
  prizePool: number;
  numPrizeSpots: number;
  currentBlindLevel: number;
  blindSchedule: BlindLevel[];
  blindLevelRemainingMs: number;
  totalPlayers: number;
  remainingPlayers: number;
  leaderboard: LeaderboardEntry[];
  scheduledStart: string;
  hostUserId: string;
}

export interface TournamentSummary {
  id: string;
  inviteCode: string;
  status: string;
  variant: string;
  buyIn: number;
  startingStack: number;
  scheduledStart: string;
  registeredCount: number;
  maxPlayers: number;
}

export interface TournamentRegistrationEntry {
  userId: string;
  displayName: string;
  registrationOrder: number;
  status: 'registered' | 'active' | 'eliminated';
}

export interface TournamentTemplate {
  id: string;
  userId: string;
  name: string;
  settings: TournamentSettings;
  createdAt: string;
}

export interface CreateTournamentTemplateRequest {
  name: string;
  settings: TournamentSettings;
}
