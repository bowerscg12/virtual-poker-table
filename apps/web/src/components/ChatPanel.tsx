import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '@vct/shared-types';

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onClose: () => void;
}

export function ChatPanel({ messages, onSend, onClose }: Props) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
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
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.isHost ? 'host' : ''}`}>
            <strong>{m.displayName}</strong>
            <span>: {m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form onSubmit={submit}>
        <input
          id="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message table…"
          maxLength={500}
        />
        <button type="submit">Send</button>
      </form>
    </aside>
  );
}
