export type Gender = 'male' | 'female';

export type SkinTone =
  | 'light-1' | 'light-2' | 'light-3'
  | 'medium-1' | 'medium-2' | 'medium-3'
  | 'dark-1' | 'dark-2' | 'dark-3';

export type HairStyle =
  | 'bald' | 'buzz' | 'short' | 'medium'
  | 'long' | 'curly' | 'wavy' | 'straight';

export type HairColor = 'black' | 'brown' | 'blonde' | 'red' | 'gray';

export type EyeColor = 'brown' | 'blue' | 'green' | 'hazel' | 'gray';

export interface AvatarConfig {
  gender: Gender;
  skinTone: SkinTone;
  hairStyle: HairStyle;
  hairColor: HairColor;
  eyeColor: EyeColor;
}

export const DEFAULT_AVATAR: AvatarConfig = {
  gender: 'male',
  skinTone: 'medium-1',
  hairStyle: 'short',
  hairColor: 'brown',
  eyeColor: 'brown',
};
