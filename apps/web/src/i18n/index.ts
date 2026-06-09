import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en';
import es from './locales/es';

export type AppLanguage = 'en' | 'es';

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: 'English',
  es: 'Español',
};

function getInitialLanguage(): AppLanguage {
  try {
    const raw = localStorage.getItem('vct_settings');
    if (raw) {
      const parsed: { language?: string } = JSON.parse(raw);
      if (parsed.language === 'es') return 'es';
    }
  } catch {
    // ignore
  }
  return 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: getInitialLanguage(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
