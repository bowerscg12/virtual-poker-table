import type { AvatarConfig, HairStyle, SkinTone, HairColor, EyeColor } from '@vct/shared-types';

// ── Palette maps ──────────────────────────────────────────────────────────────

export const SKIN_TONE_COLORS: Record<SkinTone, { base: string; shadow: string; mouth: string }> = {
  'light-1':  { base: '#FFEEE0', shadow: '#F0D0B5', mouth: '#D4997A' },
  'light-2':  { base: '#F5CBA7', shadow: '#E0B080', mouth: '#C07850' },
  'light-3':  { base: '#E8B88A', shadow: '#CCA060', mouth: '#B06840' },
  'medium-1': { base: '#D4956A', shadow: '#B87040', mouth: '#9B5030' },
  'medium-2': { base: '#C47A45', shadow: '#A05820', mouth: '#8A4018' },
  'medium-3': { base: '#A0522D', shadow: '#7A3818', mouth: '#6A2810' },
  'dark-1':   { base: '#8B4513', shadow: '#6A3010', mouth: '#5A2808' },
  'dark-2':   { base: '#6B3A2A', shadow: '#502815', mouth: '#402010' },
  'dark-3':   { base: '#4A2311', shadow: '#350D05', mouth: '#2A0A03' },
};

export const HAIR_COLOR_VALUES: Record<HairColor, string> = {
  black:  '#1A1208',
  brown:  '#5C3317',
  blonde: '#D4A843',
  red:    '#B03010',
  gray:   '#909090',
};

export const EYE_COLOR_VALUES: Record<EyeColor, string> = {
  brown:  '#7B4A1E',
  blue:   '#2E86AB',
  green:  '#4D8C57',
  hazel:  '#8B7355',
  gray:   '#7F8C8D',
};

// Swatch labels for the creator UI
export const HAIR_STYLE_LABELS: Record<HairStyle, string> = {
  bald:           'Bald',
  buzz:           'Buzz',
  'side-part':    'Side Part',
  afro:           'Afro',
  bob:            'Bob',
  'long-straight':'Long Straight',
  'long-wavy':    'Long Wavy',
  bun:            'Bun',
  curly:          'Curly',
  beanie:         'Beanie',
};

// ── Color helpers ───────────────────────────────────────────────────────────────

function shade(hex: string, factor: number): string {
  const h = hex.replace('#', '');
  const num = parseInt(h, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((num >> 16) & 255) * factor);
  const g = clamp(((num >> 8) & 255) * factor);
  const b = clamp((num & 255) * factor);
  return `rgb(${r},${g},${b})`;
}

// ── Hair rendering ────────────────────────────────────────────────────────────
//
// Face circle: cx=50, cy=52, r=34 in a 100×110 viewBox.
// Hair is rendered in two layers: `back` sits behind BOTH the shoulders and the
// face circle (long hair, buns) so any length below the neck flows behind the
// avatar instead of covering the lower head or body; `front` sits on top of the
// face (caps, fringes, partings). Each style is designed for a clearly different
// SILHOUETTE so it reads at poker-table size.

interface HairElements {
  back?: React.ReactNode;   // rendered behind the shoulders and face circle
  front?: React.ReactNode;  // rendered on top of the face circle
}

function renderHair(style: HairStyle, color: string): HairElements {
  const dark = shade(color, 0.72);
  const light = shade(color, 1.28);

  // Every front cap begins its arc at the head-circle temples (16,52)/(84,52) so
  // the arc coincides with the head's own top edge — the crown is always covered
  // and the sides never leave a bald sliver. Styles differ in their hairline,
  // back layer, and added volume, not in where they meet the head.
  switch (style) {
    // ── Cropped & short ────────────────────────────────────────────────────────
    case 'bald':
      return {};

    case 'buzz':
      // Even stubble covering the whole scalp with a softly rounded hairline.
      return {
        front: (
          <path
            d="M 16 52 A 34 34 0 0 1 84 52 Q 82 39 72 36 Q 50 32 28 36 Q 18 39 16 52 Z"
            fill={color}
          />
        ),
      };

    case 'beanie': {
      // A knit beanie pulled down to the hairline. Hair is fully hidden, so this
      // style ignores the selected hair colour and always renders in blue.
      const beanie = '#2F6BD8';
      const beanieDark = shade(beanie, 0.74);
      const beanieLight = shade(beanie, 1.18);
      return {
        front: (
          <>
            {/* rounded crown / dome (its lower edge is covered by the cuff) */}
            <path
              d="M 13 37 Q 11 12 50 11 Q 89 12 87 37 Q 50 40 13 37 Z"
              fill={beanie}
            />
            {/* folded cuff band hugging the forehead, sitting just above the brows */}
            <path
              d="M 11 30 Q 50 25 89 30 Q 91 34 89 38 Q 50 42 11 38 Q 9 34 11 30 Z"
              fill={beanieDark}
            />
            {/* seam where the cuff meets the dome */}
            <path d="M 13 31 Q 50 27 87 31" stroke={beanieLight} strokeWidth="1.3" fill="none" opacity="0.4" />
            {/* subtle knit ribs on the cuff */}
            <path d="M 28 31 L 28 39" stroke={beanieLight} strokeWidth="1" fill="none" opacity="0.3" />
            <path d="M 50 30 L 50 40" stroke={beanieLight} strokeWidth="1" fill="none" opacity="0.3" />
            <path d="M 72 31 L 72 39" stroke={beanieLight} strokeWidth="1" fill="none" opacity="0.3" />
          </>
        ),
      };
    }

    case 'side-part':
      // Hair swept across from a defined parting line on the left.
      return {
        front: (
          <>
            <path
              d="M 16 52 A 34 34 0 0 1 84 52 Q 83 36 70 33 Q 60 44 44 40 Q 34 35 26 36 Q 18 40 16 52 Z"
              fill={color}
            />
            <path d="M 38 22 Q 42 30 47 37" stroke={dark} strokeWidth="1.6" fill="none" opacity="0.5" />
            <path d="M 54 31 Q 64 31 71 35" stroke={light} strokeWidth="1.6" fill="none" opacity="0.35" />
          </>
        ),
      };

    case 'afro': {
      // Large rounded halo. Back mass gives the volume; the front cap covers the
      // crown and forehead so no bald ring shows under the hair.
      const bumps: Array<[number, number, number]> = [
        [22, 32, 12], [36, 20, 13], [50, 15, 13], [64, 20, 13], [78, 32, 12],
        [15, 48, 11], [85, 48, 11], [20, 62, 10], [80, 62, 10],
      ];
      return {
        back: (
          <g fill={color}>
            <circle cx="50" cy="44" r="37" />
            {bumps.map(([x, y, rr], i) => (
              <circle key={i} cx={x} cy={y} r={rr} />
            ))}
          </g>
        ),
        front: (
          <path
            d="M 16 52 A 34 34 0 0 1 84 52 Q 82 42 72 40 Q 50 36 28 40 Q 18 42 16 52 Z"
            fill={color}
          />
        ),
      };
    }

    // ── Long & styled ────────────────────────────────────────────────────────────
    case 'bob':
      // Chin-length blunt cut with straight bangs.
      return {
        back: (
          <path
            d="M 15 52 L 15 74 Q 16 83 26 83 Q 50 81 74 83 Q 84 83 85 74 L 85 52 A 35 35 0 0 0 15 52 Z"
            fill={color}
          />
        ),
        front: (
          <path
            d="M 16 50 A 34 34 0 0 1 84 50 Q 84 43 76 42 Q 50 37 24 42 Q 16 43 16 50 Z"
            fill={color}
          />
        ),
      };

    case 'long-straight':
      // Long, sleek, blunt-bottomed with a center part.
      return {
        back: (
          <>
            <path
              d="M 14 52 L 14 102 Q 14 106 19 106 L 81 106 Q 86 106 86 102 L 86 52 A 36 36 0 0 0 14 52 Z"
              fill={color}
            />
            <path d="M 24 64 L 24 102" stroke={dark} strokeWidth="1.4" opacity="0.3" />
            <path d="M 76 64 L 76 102" stroke={light} strokeWidth="1.4" opacity="0.3" />
          </>
        ),
        front: (
          <path
            d="M 16 52 A 34 34 0 0 1 84 52 Q 82 39 66 35 Q 56 33 50 41 Q 44 33 34 35 Q 18 39 16 52 Z"
            fill={color}
          />
        ),
      };

    case 'long-wavy':
      // Long with a scalloped, wavy bottom edge.
      return {
        back: (
          <>
            <path
              d="M 14 52 Q 10 78 14 98 Q 17 106 25 101 Q 33 96 41 102 Q 50 107 59 102 Q 67 96 75 101 Q 83 106 86 98 Q 90 78 86 52 A 36 36 0 0 0 14 52 Z"
              fill={color}
            />
            <path d="M 22 66 Q 18 82 24 96" stroke={dark} strokeWidth="1.4" fill="none" opacity="0.3" />
            <path d="M 78 66 Q 82 82 76 96" stroke={light} strokeWidth="1.4" fill="none" opacity="0.3" />
          </>
        ),
        front: (
          <path
            d="M 16 52 A 34 34 0 0 1 84 52 Q 80 38 67 35 Q 57 41 50 38 Q 43 41 33 35 Q 20 38 16 52 Z"
            fill={color}
          />
        ),
      };

    case 'bun':
      // Hair pulled up into a round bun centered above the crown.
      return {
        back: (
          <g>
            <path d="M 41 22 Q 50 17 59 22 L 57 30 Q 50 32 43 30 Z" fill={color} />
            <circle cx="50" cy="15" r="11" fill={color} />
            <ellipse cx="50" cy="15" rx="11" ry="10.5" fill="none" stroke={dark} strokeWidth="1.2" opacity="0.4" />
            <ellipse cx="50" cy="25" rx="10" ry="2.6" fill={dark} opacity="0.5" />
          </g>
        ),
        front: (
          <path
            d="M 16 52 A 34 34 0 0 1 84 52 Q 82 34 50 30 Q 18 34 16 52 Z"
            fill={color}
          />
        ),
      };

    case 'curly': {
      // Voluminous curls framing the face and cascading down the sides.
      const bumps: Array<[number, number, number]> = [
        [25, 36, 13], [36, 24, 13], [50, 20, 14], [64, 24, 13], [75, 36, 13],
        [16, 54, 12], [84, 54, 12], [21, 72, 12], [79, 72, 12],
        [31, 86, 11], [69, 86, 11], [50, 89, 11],
      ];
      return {
        back: (
          <g fill={color}>
            <circle cx="50" cy="48" r="34" />
            {bumps.map(([x, y, rr], i) => (
              <circle key={i} cx={x} cy={y} r={rr} />
            ))}
          </g>
        ),
        front: (
          <path
            d="M 16 52 A 34 34 0 0 1 84 52 Q 81 45 74 48 Q 70 41 62 46 Q 56 40 50 46
               Q 44 40 38 46 Q 30 41 26 48 Q 19 45 16 52 Z"
            fill={color}
          />
        ),
      };
    }

    default:
      return {};
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  config: AvatarConfig;
  /** Rendered width in px; height is 1.1× this value. */
  size?: number;
}

export function AvatarSvg({ config, size = 60 }: Props) {
  const skin = SKIN_TONE_COLORS[config.skinTone];
  const hairColor = HAIR_COLOR_VALUES[config.hairColor];
  const eyeColor = EYE_COLOR_VALUES[config.eyeColor];
  const hair = renderHair(config.hairStyle, hairColor);

  // Eyebrow color: use dark brown for bald/blonde/gray, else match hair
  const browColor =
    config.hairStyle === 'bald' || config.hairColor === 'blonde' || config.hairColor === 'gray'
      ? '#4A3020'
      : hairColor;

  return (
    <svg
      viewBox="0 0 100 110"
      width={size}
      height={Math.round(size * 1.1)}
      aria-hidden
      style={{ display: 'block', flexShrink: 0 }}
    >
      {/* Hair — back layer (long hair, buns). Rendered first so any length that
          falls below the neck flows BEHIND the shoulders and body rather than
          sitting on top of them. The shoulders and face are drawn over it, which
          keeps a clean head silhouette and neck transition from the front. */}
      {hair.back}

      {/* Shoulders */}
      <path
        d="M 5 110 Q 8 92 26 87 Q 50 82 74 87 Q 92 92 95 110 Z"
        fill={skin.base}
      />

      {/* Face */}
      <circle cx="50" cy="52" r="34" fill={skin.base} />

      {/* Hair — front cap */}
      {hair.front}

      {/* Eyebrows */}
      <path
        d="M 32 44 Q 38 41 44 44"
        stroke={browColor}
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 56 44 Q 62 41 68 44"
        stroke={browColor}
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />

      {/* Eyes — whites */}
      <ellipse cx="38" cy="52" rx="7" ry="6" fill="white" />
      <ellipse cx="62" cy="52" rx="7" ry="6" fill="white" />

      {/* Iris */}
      <circle cx="38" cy="52" r="4.5" fill={eyeColor} />
      <circle cx="62" cy="52" r="4.5" fill={eyeColor} />

      {/* Pupil */}
      <circle cx="38" cy="52" r="2" fill="#111" />
      <circle cx="62" cy="52" r="2" fill="#111" />

      {/* Eye shine */}
      <circle cx="39.5" cy="50.5" r="1.2" fill="rgba(255,255,255,0.75)" />
      <circle cx="63.5" cy="50.5" r="1.2" fill="rgba(255,255,255,0.75)" />

      {/* Nose — very subtle */}
      <path
        d="M 50 58 Q 47 64 48.5 67 Q 50 68.5 51.5 67 Q 53 64 50 58"
        fill={skin.shadow}
        opacity="0.45"
      />

      {/* Mouth */}
      <path
        d="M 41 72 Q 50 79 59 72"
        stroke={skin.mouth}
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
