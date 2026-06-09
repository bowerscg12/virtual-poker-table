import { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import i18n, { LANGUAGE_LABELS, type AppLanguage } from '../i18n';

type Mode = 'signin' | 'register' | 'guest';

function switchLanguage(lang: AppLanguage) {
  i18n.changeLanguage(lang);
  try {
    const raw = localStorage.getItem('vct_settings');
    const settings = raw ? JSON.parse(raw) : {};
    localStorage.setItem('vct_settings', JSON.stringify({ ...settings, language: lang }));
  } catch {
    // ignore
  }
}

export default function LoginPage() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('signin');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { user, loginAccount, registerAccount, loginGuest } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from ?? '/';

  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setUsername('');
    setPassword('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        await loginAccount(username.trim(), password);
      } else if (mode === 'register') {
        await registerAccount(displayName.trim(), username.trim(), password);
      } else {
        await loginGuest(displayName.trim());
      }
      navigate(from, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('login.somethingWentWrong');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit =
    !loading &&
    (mode === 'signin'
      ? username.trim().length > 0 && password.length > 0
      : mode === 'register'
      ? displayName.trim().length > 0 && username.trim().length >= 3 && password.length >= 6
      : displayName.trim().length > 0);

  const currentLang = i18n.language as AppLanguage;

  return (
    <div className="page home">
      <header className="hero">
        <h1>{t('login.title')}</h1>
        <p>{t('login.subtitle')}</p>
      </header>

      <div className="panel login-panel">
        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab${mode === 'signin' ? ' active' : ''}`}
            onClick={() => switchMode('signin')}
          >
            {t('login.signIn')}
          </button>
          <button
            type="button"
            className={`login-tab${mode === 'register' ? ' active' : ''}`}
            onClick={() => switchMode('register')}
          >
            {t('login.createAccount')}
          </button>
          <button
            type="button"
            className={`login-tab${mode === 'guest' ? ' active' : ''}`}
            onClick={() => switchMode('guest')}
          >
            {t('login.guest')}
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {(mode === 'register' || mode === 'guest') && (
            <label>
              {t('login.displayName')}
              <input
                type="text"
                placeholder={t('login.displayNamePlaceholder')}
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value.slice(0, 10)); setError(null); }}
                maxLength={10}
                autoComplete="nickname"
                autoFocus
                disabled={loading}
              />
              <span className="field-hint">{t('login.displayNameHint')}</span>
            </label>
          )}

          {(mode === 'signin' || mode === 'register') && (
            <label>
              {t('login.username')}
              <input
                type="text"
                placeholder={mode === 'register' ? t('login.usernameRegisterPlaceholder') : t('login.usernamePlaceholder')}
                value={username}
                onChange={(e) => { setUsername(e.target.value.slice(0, 20)); setError(null); }}
                autoComplete="username"
                autoFocus={mode === 'signin'}
                maxLength={20}
                disabled={loading}
              />
              {mode === 'register' && (
                <span className="field-hint">{t('login.usernameHint')}</span>
              )}
            </label>
          )}

          {(mode === 'signin' || mode === 'register') && (
            <label>
              {t('login.password')}
              <input
                type="password"
                placeholder={mode === 'register' ? t('login.passwordMinHint') : t('login.password')}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                disabled={loading}
              />
            </label>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          {mode === 'register' && (
            <p className="policy-notice">
              {t('login.policyNotice')}{' '}
              <Link to="/privacy" target="_blank" rel="noopener noreferrer">{t('login.privacyPolicy')}</Link>.
            </p>
          )}

          <button type="submit" className="btn primary" disabled={!canSubmit}>
            {loading
              ? t('login.pleaseWait')
              : mode === 'signin'
              ? t('login.signIn')
              : mode === 'register'
              ? t('login.createAccount')
              : t('login.continueAsGuest')}
          </button>
        </form>
      </div>

      <footer className="disclaimer">
        {t('login.disclaimer')}
        {' · '}
        <Link to="/privacy">{t('login.privacyPolicy')}</Link>

        <div className="login-lang-switcher" role="group" aria-label={t('settings.language')}>
          {(Object.keys(LANGUAGE_LABELS) as AppLanguage[]).map((lang) => (
            <button
              key={lang}
              type="button"
              className={`login-lang-btn${currentLang === lang ? ' active' : ''}`}
              onClick={() => switchLanguage(lang)}
              aria-pressed={currentLang === lang ? 'true' : 'false'}
            >
              {LANGUAGE_LABELS[lang]}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
