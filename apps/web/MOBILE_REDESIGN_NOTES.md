# Mobile UI — redesign notes (follow-up backlog)

These are deferred, larger mobile improvements. The first pass (already shipped)
fixed the acute overlap/overflow problems and made **portrait a first-class
layout** (the "rotate your device" gate was removed). What follows is the next
tier of work — bigger structural changes that were intentionally left out of the
targeted pass.

## Context: what the first pass changed

- **Seat ring is orientation-aware.** `PokerTable.tsx` reads `SEAT_RING.portrait`
  (narrower x-radius) vs `SEAT_RING.landscape` via a `useIsPortrait()` hook, so side
  seats stop crowding the board on the narrow portrait felt.
- **Board stays on top.** On phones (`max-width: 640px`, `max-height: 500px`) the
  `.pot-area`/`.board` get a higher z-index than `.seat` plus a tray backdrop.
- **Raise panel is bounded.** The breakout popover is `clamp()`-sized and capped to the
  felt-side space; landscape and portrait share one compact internal layout and differ
  only in anchor direction (right vs. up).
- **Board-decision prompts are bottom sheets** on phones (RunItOut / BombPot / ShowCards)
  with a translucent scrim, so the board stays visible while deciding.
- **Portrait layout** stacks `table-main` into a column with a full-width bottom action
  bar, a portrait (`4/5`) felt, and `clamp()`-sized board cards.
- **Safe-area insets** applied to the header, landscape hero panel, and bottom sheets.

## Backlog

### 1. Chat as a bottom-sheet / drawer
Today chat is a `width: 100%` fixed overlay at `≤600px` (`styles.css`, `.chat-panel`),
so opening it hides the entire table. Replace with a partial-height bottom drawer (or a
side drawer in landscape) that doesn't cover the felt, with swipe-to-dismiss and a
translucent scrim. Keep the unread badge in `TableHeader`.

### 2. Fuller small-screen seat-ring redesign
The literal oval ring is tight on very small phones even after the radius tuning. Consider
a "hero-centric" layout: opponents as a compact top rail (avatars + stacks) and the local
player's zone anchored at the bottom, instead of everyone on one ellipse. This is a larger
change to `PokerTable.tsx` seat placement and would likely want a dedicated mobile render
path rather than CSS overrides.

### 3. Reaction picker / badge density on mobile
Player badges and the reaction picker can crowd compact capsules. Tune badge count/size
per breakpoint and consider collapsing badges behind a tap-to-expand affordance on phones.

### 4. Blackjack portrait pass
`.bj-felt` uses a very wide `aspect-ratio: 2.2`, which becomes short in portrait. The rail
now wraps (`flex-wrap: wrap` at `≤640px`), but a proper portrait blackjack felt (taller
oval, repositioned dealer zone) would read better. Verify split/double layouts at 390px.

### 5. 12-Card-Flip portrait spot-check
TCF is already responsive (`clamp()` grid). Confirm the grid + action row don't collide
with the new bottom-bar paradigm now that portrait is allowed.
