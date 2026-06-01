export type Gender = 'male' | 'female';

export type SkinTone =
  | 'light-1' | 'light-2' | 'light-3'
  | 'medium-1' | 'medium-2' | 'medium-3'
  | 'dark-1' | 'dark-2' | 'dark-3';

export type HairStyle =
  // Cropped & short (default-masculine set, but selectable by anyone)
  | 'bald' | 'buzz' | 'side-part' | 'afro' | 'beanie'
  // Long & styled (default-feminine set, but selectable by anyone)
  | 'bob' | 'long-straight' | 'long-wavy' | 'bun' | 'curly';

export type HairColor = 'black' | 'brown' | 'blonde' | 'red' | 'gray';

export type EyeColor = 'brown' | 'blue' | 'green' | 'hazel' | 'gray';

export interface AvatarConfig {
  gender: Gender;
  skinTone: SkinTone;
  hairStyle: HairStyle;
  hairColor: HairColor;
  eyeColor: EyeColor;
}

// ── Canonical option lists (also the display order in the creator UI) ──────────

export const SKIN_TONES: SkinTone[] = [
  'light-1', 'light-2', 'light-3',
  'medium-1', 'medium-2', 'medium-3',
  'dark-1', 'dark-2', 'dark-3',
];

export const HAIR_COLORS: HairColor[] = ['black', 'brown', 'blonde', 'red', 'gray'];

export const EYE_COLORS: EyeColor[] = ['brown', 'blue', 'green', 'hazel', 'gray'];

/** Shorter, cropped, and tied-up styles. Used as the default group for male avatars. */
export const SHORT_HAIR_STYLES: HairStyle[] = [
  'bald', 'buzz', 'side-part', 'afro', 'beanie',
];

/** Longer and more elaborately styled cuts. Used as the default group for female avatars. */
export const LONG_HAIR_STYLES: HairStyle[] = [
  'bob', 'long-straight', 'long-wavy', 'bun', 'curly',
];

export const ALL_HAIR_STYLES: HairStyle[] = [...SHORT_HAIR_STYLES, ...LONG_HAIR_STYLES];

// ── Per-gender defaults ────────────────────────────────────────────────────────

export const DEFAULT_MALE_HAIR_STYLE: HairStyle = 'side-part';
export const DEFAULT_FEMALE_HAIR_STYLE: HairStyle = 'long-wavy';

export function defaultHairStyleFor(gender: Gender): HairStyle {
  return gender === 'female' ? DEFAULT_FEMALE_HAIR_STYLE : DEFAULT_MALE_HAIR_STYLE;
}

export const DEFAULT_AVATAR: AvatarConfig = {
  gender: 'male',
  skinTone: 'medium-1',
  hairStyle: DEFAULT_MALE_HAIR_STYLE,
  hairColor: 'brown',
  eyeColor: 'brown',
};

// ── Validation / coercion ───────────────────────────────────────────────────────
//
// Avatars are persisted in localStorage and echoed back through the lobby. Older
// saved configs may reference hairstyles that no longer exist, so coerce any
// unknown field back to a sensible default rather than rendering a broken avatar.

export function isHairStyle(v: unknown): v is HairStyle {
  return typeof v === 'string' && (ALL_HAIR_STYLES as string[]).includes(v);
}

export function coerceAvatar(raw: Partial<AvatarConfig> | null | undefined): AvatarConfig {
  const a = raw ?? {};
  const gender: Gender = a.gender === 'female' ? 'female' : 'male';
  return {
    gender,
    skinTone: (SKIN_TONES as string[]).includes(a.skinTone as string)
      ? (a.skinTone as SkinTone)
      : DEFAULT_AVATAR.skinTone,
    hairStyle: isHairStyle(a.hairStyle) ? a.hairStyle : defaultHairStyleFor(gender),
    hairColor: (HAIR_COLORS as string[]).includes(a.hairColor as string)
      ? (a.hairColor as HairColor)
      : DEFAULT_AVATAR.hairColor,
    eyeColor: (EYE_COLORS as string[]).includes(a.eyeColor as string)
      ? (a.eyeColor as EyeColor)
      : DEFAULT_AVATAR.eyeColor,
  };
}
