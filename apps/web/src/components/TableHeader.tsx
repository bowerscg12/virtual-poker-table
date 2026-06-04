import type { LobbySummary } from '@vct/shared-types';

interface Props {
  lobby: LobbySummary | null;
  isHost: boolean;
  connected: boolean;
  reconnecting: boolean;
  unreadChat: number;
  chatOpen: boolean;
  onCopyInvite: () => void;
  onChatToggle: () => void;
  onHistoryToggle: () => void;
}

export function TableHeader({
  lobby,
  isHost,
  connected,
  reconnecting,
  unreadChat,
  chatOpen,
  onCopyInvite,
  onChatToggle,
  onHistoryToggle,
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
      </div>
      <div className="table-header__right">
        <button type="button" className="btn small" onClick={onHistoryToggle}>
          History
        </button>
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
      </div>
    </header>
  );
}
