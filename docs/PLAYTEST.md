# Friend playtest checklist

## Before the session

- [ ] Staging URL shared with all players
- [ ] Everyone can sign in (guest name is fine)
- [ ] Voice: LiveKit env vars set (optional)

## Lobby flow

- [ ] Host creates table with chosen preset
- [ ] Invite link copies and opens on second device
- [ ] Guest joins and takes a seat with buy-in
- [ ] Host sees both players seated

## One full hand (NL Hold'em)

- [ ] Host starts hand
- [ ] Blinds posted correctly
- [ ] Each player only sees their own hole cards
- [ ] Betting: fold, check, call, raise, all-in
- [ ] Board deals flop → turn → river
- [ ] Showdown awards pot; stacks update

## Social

- [ ] Table chat sends/receives for all seated players
- [ ] Host can kick (between hands)
- [ ] Host pause/resume

## Reconnect

- [ ] Refresh page — player rejoins same lobby state

## Phase 2 (if enabled)

- [ ] Omaha preset deals 4 hole cards
- [ ] Bomb pot preset triggers on schedule
- [ ] Hand history panel shows completed hands

## Sign-off

- [ ] No hole cards leaked to wrong client (watch Network WS payloads)
- [ ] Chip totals conserved after hand
