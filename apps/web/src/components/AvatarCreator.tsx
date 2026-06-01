import type {
  AvatarConfig,
  Gender,
  SkinTone,
  HairStyle,
  HairColor,
  EyeColor,
} from '@vct/shared-types';
import { AvatarSvg, SKIN_TONE_COLORS, HAIR_COLOR_VALUES, EYE_COLOR_VALUES, HAIR_STYLE_LABELS } from './AvatarSvg';

interface Props {
  value: AvatarConfig;
  onChange: (next: AvatarConfig) => void;
}

const SKIN_TONES = Object.keys(SKIN_TONE_COLORS) as SkinTone[];
const HAIR_STYLES = Object.keys(HAIR_STYLE_LABELS) as HairStyle[];
const HAIR_COLORS = Object.keys(HAIR_COLOR_VALUES) as HairColor[];
const EYE_COLORS = Object.keys(EYE_COLOR_VALUES) as EyeColor[];

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male',   label: 'Male'   },
  { value: 'female', label: 'Female' },
];

export function AvatarCreator({ value, onChange }: Props) {
  function patch(partial: Partial<AvatarConfig>) {
    onChange({ ...value, ...partial });
  }

  return (
    <div className="avatar-creator">
      {/* Live preview */}
      <div className="avatar-preview-wrap">
        <AvatarSvg config={value} size={96} />
      </div>

      {/* Gender */}
      <div className="avatar-row">
        <span className="avatar-label">Style</span>
        <div className="avatar-toggle">
          {GENDER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`avatar-toggle-btn${value.gender === opt.value ? ' active' : ''}`}
              onClick={() => patch({ gender: opt.value })}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Skin Tone */}
      <div className="avatar-row">
        <span className="avatar-label">Skin</span>
        <div className="avatar-swatches">
          {SKIN_TONES.map((tone) => (
            <button
              key={tone}
              type="button"
              className={`avatar-swatch${value.skinTone === tone ? ' selected' : ''}`}
              style={{ background: SKIN_TONE_COLORS[tone].base }}
              onClick={() => patch({ skinTone: tone })}
              aria-label={tone}
              title={tone}
            />
          ))}
        </div>
      </div>

      {/* Hair Style */}
      <div className="avatar-row avatar-row-wrap">
        <span className="avatar-label">Hair</span>
        <div className="avatar-chips">
          {HAIR_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              className={`avatar-chip${value.hairStyle === style ? ' selected' : ''}`}
              onClick={() => patch({ hairStyle: style })}
            >
              {HAIR_STYLE_LABELS[style]}
            </button>
          ))}
        </div>
      </div>

      {/* Hair Color */}
      <div className="avatar-row">
        <span className="avatar-label">Hair color</span>
        <div className="avatar-swatches">
          {HAIR_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`avatar-swatch${value.hairColor === color ? ' selected' : ''}`}
              style={{ background: HAIR_COLOR_VALUES[color] }}
              onClick={() => patch({ hairColor: color })}
              aria-label={color}
              title={color}
            />
          ))}
        </div>
      </div>

      {/* Eye Color */}
      <div className="avatar-row">
        <span className="avatar-label">Eyes</span>
        <div className="avatar-swatches">
          {EYE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`avatar-swatch${value.eyeColor === color ? ' selected' : ''}`}
              style={{ background: EYE_COLOR_VALUES[color] }}
              onClick={() => patch({ eyeColor: color })}
              aria-label={color}
              title={color}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
