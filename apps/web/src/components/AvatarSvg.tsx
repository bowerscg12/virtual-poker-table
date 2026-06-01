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
  bald:     'Bald',
  buzz:     'Buzz',
  short:    'Short',
  medium:   'Medium',
  long:     'Long',
  curly:    'Curly',
  wavy:     'Wavy',
  straight: 'Straight',
};

// ── Hair rendering ────────────────────────────────────────────────────────────
//
// Face circle: cx=50, cy=52, r=34 in a 100×110 viewBox.
// Intersection y-values computed from the circle equation:
//   x = 50 ± sqrt(34² − (y−52)²)
//
//   y=26 → x ≈ 28, 72  (buzz)
//   y=35 → x ≈ 21, 79  (short cap)
//   y=44 → x ≈ 17, 83  (medium cap)
//   y=52 → x = 16, 84  (equator — long/straight)

interface HairElements {
  back?: React.ReactNode;   // rendered behind the face circle
  front?: React.ReactNode;  // rendered on top of the face circle
}

function renderHair(style: HairStyle, color: string): HairElements {
  switch (style) {
    case 'bald':
      return {};

    case 'buzz':
      // Very thin cap — just the top sliver
      return {
        front: <path d="M 28 26 A 34 34 0 0 1 72 26 Z" fill={color} />,
      };

    case 'short':
      return {
        front: <path d="M 21 35 A 34 34 0 0 1 79 35 Z" fill={color} />,
      };

    case 'medium':
      return {
        front: <path d="M 17 44 A 34 34 0 0 1 83 44 Z" fill={color} />,
      };

    case 'straight':
      // Same cap height as medium but with straight side panels reaching lower
      return {
        back: (
          <path
            d="M 16 52 L 16 82 Q 20 88 28 86 Q 50 82 72 86 Q 80 88 84 82 L 84 52 A 34 34 0 0 0 16 52"
            fill={color}
          />
        ),
        front: <path d="M 17 44 A 34 34 0 0 1 83 44 Z" fill={color} />,
      };

    case 'long':
      return {
        back: (
          <path
            d="M 16 52 Q 10 68 12 95 Q 18 90 26 86 Q 50 80 74 86 Q 82 90 88 95 Q 90 68 84 52 A 34 34 0 0 0 16 52"
            fill={color}
          />
        ),
        front: <path d="M 16 52 A 34 34 0 0 1 84 52 Z" fill={color} />,
      };

    case 'curly': {
      // Overlapping circles create a bumpy/voluminous top
      const cx = 50, cy = 52, r = 34;
      const bumps: React.ReactNode[] = [];
      const bumpPositions = [
        { x: cx,      y: cy - r - 4, r: 11 },
        { x: cx - 14, y: cy - r + 2, r: 10 },
        { x: cx + 14, y: cy - r + 2, r: 10 },
        { x: cx - 24, y: cy - r + 12, r: 9  },
        { x: cx + 24, y: cy - r + 12, r: 9  },
      ];
      bumpPositions.forEach((b, i) => {
        bumps.push(<circle key={i} cx={b.x} cy={b.y} r={b.r} fill={color} />);
      });
      return {
        front: (
          <>
            {bumps}
            {/* Fill base cap to smooth connection */}
            <path d="M 17 44 A 34 34 0 0 1 83 44 Z" fill={color} />
          </>
        ),
      };
    }

    case 'wavy':
      // Medium cap with a wavy bottom edge created by quadratic bezier bumps
      return {
        front: (
          <path
            d="M 17 44 Q 22 38 28 44 Q 34 50 40 44 Q 46 38 52 44 Q 58 50 64 44 Q 70 38 76 44 A 34 34 0 0 0 17 44"
            fill={color}
          />
        ),
      };
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
      {/* Shoulders */}
      <path
        d="M 5 110 Q 8 92 26 87 Q 50 82 74 87 Q 92 92 95 110 Z"
        fill={skin.base}
      />

      {/* Hair — back layer (long/straight) */}
      {hair.back}

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
