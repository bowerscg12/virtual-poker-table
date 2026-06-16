import type { LobbySummary } from '@vct/shared-types';
import type { AppSettings } from '../hooks/useSettings';
import { SettingsMenu } from './SettingsMenu';

interface Props {
  lobby: LobbySummary | null;
  isHost: boolean;
  connected: boolean;
  reconnecting: boolean;
  unreadChat: number;
  chatOpen: boolean;
  settings: AppSettings;
  onCopyInvite: () => void;
  onCopyWatchLink: () => void;
  onChatToggle: () => void;
  onSettingChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  /** SHA-256 hex digest of the RNG seed for the last completed hand — provably fair. */
  lastHandSeed?: string;
}

export function TableHeader({
  lobby,
  isHost,
  connected,
  reconnecting,
  unreadChat,
  chatOpen,
  settings,
  onCopyInvite,
  onCopyWatchLink,
  onChatToggle,
  onSettingChange,
  lastHandSeed,
}: Props) {
  const statusClass = connected ? 'on' : reconnecting ? 'reconnecting' : 'off';
  const statusTitle = connected ? 'Connected' : reconnecting ? 'Reconnecting...' : 'Disconnected';

  return (
    <header className="table-header">
      <div className="table-header__left">
        <div className="table-header__title">
          {isHost && (
            <span className="table-header__crown" title="You are the host" aria-label="Host">
              ♛
            </span>
          )}
          <span className="table-header__name">
            {lobby ? `${lobby.hostDisplayName}'s Table` : 'Table...'}
          </span>
          <span
            className={`table-header__dot table-header__dot--${statusClass}`}
            title={statusTitle}
            aria-label={statusTitle}
          />
        </div>
        {lobby && (
          <button
            type="button"
            className="table-header__code"
            onClick={onCopyInvite}
            title="Copy invite link"
          >
            {lobby.inviteCode}
            <span className="table-header__copy-icon" aria-hidden="true">⎘</span>
          </button>
        )}
        {lobby && (
          <button
            type="button"
            className="table-header__watch"
            onClick={onCopyWatchLink}
            title="Copy a spectator link — opens the table in read-only watch mode"
          >
            👁 Watch link
          </button>
        )}
        {lastHandSeed && (
          <button
            type="button"
            className="table-header__seed"
            title={`SHA-256 seed for last hand: ${lastHandSeed}`}
            onClick={() => navigator.clipboard.writeText(lastHandSeed).catch(() => {})}
            aria-label="Seed verification — click to copy full hash"
          >
            🔒 seed: {lastHandSeed.slice(0, 16)}…
          </button>
        )}
      </div>
      <div className="table-header__right">
        <button
          type="button"
          className={`btn small header-chat-btn${chatOpen ? ' active' : ''}`}
          onClick={onChatToggle}
          aria-label={unreadChat > 0 ? `Chat — ${unreadChat} unread` : 'Chat'}
        >
          Chat
          {unreadChat > 0 && (
            <span className="header-chat-badge" aria-hidden="true">
              {unreadChat > 9 ? '9+' : unreadChat}
            </span>
          )}
        </button>
        <SettingsMenu settings={settings} onChange={onSettingChange} />
      </div>
    </header>
  );
}
