import { createHmac } from 'crypto';
import { config } from '../config.js';

/** Generate LiveKit access token when configured; stub otherwise */
export function getVoiceToken(lobbyId: string, userId: string, displayName: string): { token: string; roomName: string; url: string } | null {
  if (!config.livekitApiKey || !config.livekitApiSecret || !config.livekitUrl) {
    return null;
  }

  const roomName = `lobby-${lobbyId}`;
  const exp = Math.floor(Date.now() / 1000) + 3600;

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: config.livekitApiKey,
      sub: userId,
      name: displayName,
      exp,
      video: { room: roomName, roomJoin: true },
      audio: { room: roomName, roomJoin: true },
    })
  ).toString('base64url');

  const signature = createHmac('sha256', config.livekitApiSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return {
    token: `${header}.${payload}.${signature}`,
    roomName,
    url: config.livekitUrl,
  };
}
