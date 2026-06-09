import { useCallback, useState } from 'react';
import type { AppLanguage } from '../i18n';

export interface AppSettings {
  showHandStrength: boolean;
  showHandHistory: boolean;
  soundEffects: boolean;
  showPotOdds: boolean;
  language: AppLanguage;
}

const DEFAULTS: AppSettings = {
  showHandStrength: true,
  showHandHistory: false,
  soundEffects: false,
  showPotOdds: false,
  language: 'en',
};

const KEY = 'vct_settings';

function load(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(load);

  const updateSetting = useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  return { settings, updateSetting };
}
