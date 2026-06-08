import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../hooks/useSettings';

interface Props {
  settings: AppSettings;
  onChange: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
}

export function SettingsMenu({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="settings-menu" ref={menuRef}>
      <button
        type="button"
        className={`btn small settings-menu__trigger${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Settings"
        aria-expanded={open ? 'true' : 'false'}
        title="Settings"
      >
        ⚙
      </button>

      {open && (
        <div className="settings-menu__dropdown" role="dialog" aria-label="Settings">
          <div className="settings-menu__heading">Settings</div>

          <ToggleRow
            label="Hand Strength"
            description="Show hand name under your cards"
            checked={settings.showHandStrength}
            onChange={(v) => onChange('showHandStrength', v)}
          />
          <ToggleRow
            label="Hand History"
            description="Show hand history panel"
            checked={settings.showHandHistory}
            onChange={(v) => onChange('showHandHistory', v)}
          />
          <ToggleRow
            label="Pot Odds"
            description="Show pot odds % on call"
            checked={settings.showPotOdds}
            onChange={(v) => onChange('showPotOdds', v)}
          />

          <div className="settings-menu__divider" />

          <ToggleRow
            label="Sound Effects"
            description="Coming soon"
            checked={settings.soundEffects}
            onChange={(v) => onChange('soundEffects', v)}
            disabled
          />
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
