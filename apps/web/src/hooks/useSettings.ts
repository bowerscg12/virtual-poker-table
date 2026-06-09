import { useCallback, useEffect, useState } from 'react';
import type { AppLanguage } from '../i18n';
import { useAuth } from '../context/AuthContext';

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
  soundEffects: true,
  showPotOdds: false,
  language: 'en',
};

const BASE_KEY = 'vct_settings';

function settingsKey(userId?: string): string {
  return userId ? `${BASE_KEY}_${userId}` : BASE_KEY;
}

function load(userId?: string): AppSettings {
  try {
    const raw = localStorage.getItem(settingsKey(userId));
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULTS };
}

export function useSettings() {
  const { user } = useAuth();
  const userId = user?.id;

  const [settings, setSettings] = useState<AppSettings>(() => load(userId));

  // Reload from the correct key whenever the user logs in or out
  useEffect(() => {
    setSettings(load(userId));
  }, [userId]);

  const updateSetting = useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      try { localStorage.setItem(settingsKey(userId), JSON.stringify(next)); } catch {}
      return next;
    });
  }, [userId]);

  return { settings, updateSetting };
}
