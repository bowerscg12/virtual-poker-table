import { useEffect, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import { config } from '../config';

interface Props {
  voiceToken: { token: string; roomName: string } | null;
  displayName: string;
}

export function VoicePanel({ voiceToken, displayName }: Props) {
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(true);
  const [room, setRoom] = useState<Room | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    setAvailable(!!config.livekitUrl && !!voiceToken);
  }, [voiceToken]);

  async function connect() {
    if (!voiceToken || !config.livekitUrl) return;
    const r = new Room();
    await r.connect(config.livekitUrl, voiceToken.token);
    await r.localParticipant.setMicrophoneEnabled(false);
    setRoom(r);
    setConnected(true);
    setMuted(true);

    r.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        document.body.appendChild(el);
      }
    });
  }

  async function toggleMute() {
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }

  function disconnect() {
    room?.disconnect();
    setRoom(null);
    setConnected(false);
  }

  if (!available) {
    return (
      <div className="voice-panel panel muted-info">
        <p>Voice chat: configure LIVEKIT_URL on the server to enable.</p>
      </div>
    );
  }

  return (
    <div className="voice-panel panel">
      <h3>Voice</h3>
      {!connected ? (
        <button type="button" className="btn small" onClick={connect}>
          Join voice ({displayName})
        </button>
      ) : (
        <>
          <button type="button" className="btn small" onClick={toggleMute}>
            {muted ? 'Unmute (push-to-talk style)' : 'Mute'}
          </button>
          <button type="button" className="btn small" onClick={disconnect}>
            Leave voice
          </button>
        </>
      )}
    </div>
  );
}
