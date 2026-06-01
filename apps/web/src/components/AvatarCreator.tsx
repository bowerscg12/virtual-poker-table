import type {
  AvatarConfig,
  Gender,
  HairStyle,
} from '@vct/shared-types';
import {
  SKIN_TONES,
  HAIR_COLORS,
  EYE_COLORS,
  SHORT_HAIR_STYLES,
  LONG_HAIR_STYLES,
  defaultHairStyleFor,
} from '@vct/shared-types';
import { AvatarSvg, SKIN_TONE_COLORS, HAIR_COLOR_VALUES, EYE_COLOR_VALUES, HAIR_STYLE_LABELS } from './AvatarSvg';

interface Props {
  value: AvatarConfig;
  onChange: (next: AvatarConfig) => void;
}

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male',   label: 'Male'   },
  { value: 'female', label: 'Female' },
];

const HAIR_GROUPS: { title: string; styles: HairStyle[] }[] = [
  { title: 'Short & cropped', styles: SHORT_HAIR_STYLES },
  { title: 'Long & styled',   styles: LONG_HAIR_STYLES },
];

export function AvatarCreator({ value, onChange }: Props) {
  function patch(partial: Partial<AvatarConfig>) {
    onChange({ ...value, ...partial });
  }

  // Switching gender swaps to that gender's default hairstyle but preserves every
  // other setting (skin tone, hair color, eye color). Users can re-pick any style.
  function selectGender(gender: Gender) {
    if (gender === value.gender) return;
    onChange({ ...value, gender, hairStyle: defaultHairStyleFor(gender) });
  }

  return (
    <div className="avatar-creator">
      {/* Live preview */}
      <div className="avatar-preview-wrap">
        <AvatarSvg config={value} size={120} />
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
              onClick={() => selectGender(opt.value)}
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

      {/* Hair Style — large live previews grouped for easy browsing */}
      <div className="avatar-hair-section">
        <span className="avatar-label">Hairstyle</span>
        <div className="avatar-hair-groups">
          {HAIR_GROUPS.map((group) => (
            <div key={group.title} className="avatar-hair-group">
              <span className="avatar-hair-group-title">{group.title}</span>
              <div className="avatar-hair-grid">
                {group.styles.map((style) => (
                  <button
                    key={style}
                    type="button"
                    className={`avatar-hair-tile${value.hairStyle === style ? ' selected' : ''}`}
                    onClick={() => patch({ hairStyle: style })}
                    title={HAIR_STYLE_LABELS[style]}
                  >
                    <AvatarSvg config={{ ...value, hairStyle: style }} size={54} />
                    <span className="avatar-hair-tile-label">{HAIR_STYLE_LABELS[style]}</span>
                  </button>
                ))}
              </div>
            </div>
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
