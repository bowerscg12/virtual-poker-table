import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '@vct/shared-types';
import { REACTION_EMOJIS } from '@vct/shared-types';

export interface WhisperTarget {
  userId: string;
  displayName: string;
}

/** Client-side reaction throttle — mirrors the server's REACTION_COOLDOWN_MS guard. */
const REACTION_COOLDOWN_MS = 2500;

interface Props {
  messages: ChatMessage[];
  myUserId?: string;
  whisperTarget: WhisperTarget | null;
  onSend: (text: string) => void;
  onWhisper: (recipientUserId: string, text: string) => void;
  onWhisperTargetChange: (target: WhisperTarget | null) => void;
  onReact: (emoji: string) => void;
  onClose: () => void;
}

export function ChatPanel({ messages, myUserId, whisperTarget, onSend, onWhisper, onWhisperTargetChange, onReact, onClose }: Props) {
  const [text, setText] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reactCooling, setReactCooling] = useState(false);
  const pickerWrapRef = useRef<HTMLDivElement>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Close the picker on outside tap/click or Escape
  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!pickerWrapRef.current?.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  function sendReaction(emoji: string) {
    if (reactCooling) return;
    onReact(emoji);
    setPickerOpen(false);
    setReactCooling(true);
    cooldownTimerRef.current = setTimeout(() => setReactCooling(false), REACTION_COOLDOWN_MS);
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus the input when a whisper target is picked (e.g. from a seat or Reply)
  useEffect(() => {
    if (whisperTarget) {
      (document.getElementById('chat-input') as HTMLInputElement | null)?.focus();
    }
  }, [whisperTarget]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    if (whisperTarget) {
      onWhisper(whisperTarget.userId, text.trim());
    } else {
      onSend(text.trim());
    }
    setText('');
  }

  return (
    <aside className="chat-panel" aria-label="Table chat">
      <header>
        <h2>Chat</h2>
        <button type="button" onClick={onClose} aria-label="Close chat">
          ×
        </button>
      </header>
      <div className="chat-messages">
        {messages.map((m) =>
          m.isSystem ? (
            <div key={m.id} className="chat-msg system">
              <span>{m.text}</span>
            </div>
          ) : m.isWhisper ? (
            <div key={m.id} className="chat-msg whisper">
              <span className="whisper-tag">Whisper</span>
              <strong>
                {m.userId === myUserId ? 'You' : m.displayName} → {m.recipientUserId === myUserId ? 'You' : m.recipientDisplayName}
              </strong>
              <span>: {m.text}</span>
              {m.userId !== myUserId && (
                <button
                  type="button"
                  className="whisper-reply-btn"
                  onClick={() => onWhisperTargetChange({ userId: m.userId, displayName: m.displayName })}
                  aria-label={`Reply privately to ${m.displayName}`}
                >
                  Reply
                </button>
              )}
            </div>
          ) : (
            <div key={m.id} className={`chat-msg ${m.isHost ? 'host' : ''}`}>
              <strong>{m.displayName}</strong>
              <span>: {m.text}</span>
            </div>
          )
        )}
        <div ref={endRef} />
      </div>
      {whisperTarget && (
        <div className="whisper-compose-bar" role="status">
          <span>
            Whispering to <strong>{whisperTarget.displayName}</strong>
          </span>
          <button
            type="button"
            onClick={() => onWhisperTargetChange(null)}
            aria-label="Cancel whisper"
          >
            ×
          </button>
        </div>
      )}
      <form onSubmit={submit}>
        <div className="reaction-picker-wrap" ref={pickerWrapRef}>
          <button
            type="button"
            className="reaction-btn"
            onClick={() => setPickerOpen((o) => !o)}
            disabled={reactCooling}
            aria-label="Send a reaction"
            aria-expanded={pickerOpen}
            aria-haspopup="menu"
            title={reactCooling ? 'Reaction cooldown…' : 'Send a reaction'}
          >
            😀
          </button>
          {pickerOpen && (
            <div className="reaction-picker" role="menu" aria-label="Reactions">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  onClick={() => sendReaction(emoji)}
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={whisperTarget ? `Whisper to ${whisperTarget.displayName}…` : 'Message table…'}
          maxLength={500}
        />
        <button type="submit">Send</button>
      </form>
    </aside>
  );
}
