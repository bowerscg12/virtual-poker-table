import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppSettings } from '../hooks/useSettings';
import i18n, { LANGUAGE_LABELS, type AppLanguage } from '../i18n';

interface Props {
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function SettingsMenu({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  function handleLanguageChange(lang: AppLanguage) {
    onChange('language', lang);
    i18n.changeLanguage(lang);
  }

  return (
    <div className="settings-menu" ref={menuRef}>
      <button
        type="button"
        className={`btn small settings-menu__trigger${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={t('settings.title')}
        aria-expanded={open ? 'true' : 'false'}
        title={t('settings.title')}
      >
        ⚙
      </button>

      {open && (
        <div className="settings-menu__dropdown" role="dialog" aria-label={t('settings.title')}>
          <div className="settings-menu__heading">{t('settings.title')}</div>

          <ToggleRow
            label={t('settings.handStrength')}
            description={t('settings.handStrengthDesc')}
            checked={settings.showHandStrength}
            onChange={(v) => onChange('showHandStrength', v)}
          />
          <ToggleRow
            label={t('settings.handHistory')}
            description={t('settings.handHistoryDesc')}
            checked={settings.showHandHistory}
            onChange={(v) => onChange('showHandHistory', v)}
          />
          <ToggleRow
            label={t('settings.potOdds')}
            description={t('settings.potOddsDesc')}
            checked={settings.showPotOdds}
            onChange={(v) => onChange('showPotOdds', v)}
          />

          <div className="settings-menu__divider" />

          <ToggleRow
            label={t('settings.soundEffects')}
            description={t('settings.soundEffectsDesc')}
            checked={settings.soundEffects}
            onChange={(v) => onChange('soundEffects', v)}
          />

          <div className="settings-menu__divider" />

          <div className="settings-menu__row settings-menu__row--lang">
            <span className="settings-menu__row-label">{t('settings.language')}</span>
            <div className="settings-lang-buttons" role="group" aria-label={t('settings.language')}>
              {(Object.keys(LANGUAGE_LABELS) as AppLanguage[]).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  className={`btn small settings-lang-btn${settings.language === lang ? ' active' : ''}`}
                  onClick={() => handleLanguageChange(lang)}
                  aria-pressed={settings.language === lang ? 'true' : 'false'}
                >
                  {LANGUAGE_LABELS[lang]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Toggle row ────────────────────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

function ToggleRow({ label, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <div
      className={`settings-menu__row${disabled ? ' settings-menu__row--disabled' : ''}`}
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      tabIndex={disabled ? -1 : 0}
      onClick={!disabled ? () => onChange(!checked) : undefined}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <div className="settings-menu__row-text">
        <span className="settings-menu__row-label">{label}</span>
        <span className="settings-menu__row-desc">{description}</span>
      </div>
      <div
        className={`settings-toggle${checked ? ' settings-toggle--on' : ''}`}
        aria-hidden="true"
      >
        <div className="settings-toggle__knob" />
      </div>
    </div>
  );
}
