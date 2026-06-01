import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function HomePage() {
  const navigate = useNavigate();
  const { user, logout, updateDisplayName } = useAuth();

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setNameInput(user?.displayName ?? '');
      setNameError(null);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, user?.displayName]);

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  function startEditing() {
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setNameError(null);
  }

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === user?.displayName) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setNameError(null);
    try {
      await updateDisplayName(trimmed);
      setEditing(false);
    } catch (err) {
      setNameError((err as Error).message ?? 'Could not update name.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page home">
      <header className="hero">
        <h1>Virtual Card Table</h1>
        <p>Host home games online — shuffle, deal, and chips handled in-app. Settle up with friends IRL.</p>
      </header>

      <div className="panel home-identity-panel">
        {editing ? (
          <form className="home-name-edit-form" onSubmit={handleSaveName}>
            <span className="home-name-edit-label">Playing as</span>
            <input
              ref={inputRef}
              className="home-name-edit-input"
              type="text"
              value={nameInput}
              onChange={(e) => { setNameInput(e.target.value.slice(0, 10)); setNameError(null); }}
              maxLength={10}
              disabled={saving}
              aria-label="Display name"
            />
            {nameError && <span className="home-name-edit-error">{nameError}</span>}
            <div className="home-name-edit-actions">
              <button type="submit" className="btn small primary" disabled={saving || !nameInput.trim()}>
                Save
              </button>
              <button type="button" className="btn small" onClick={cancelEditing} disabled={saving}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <span className="home-user-name">
            Playing as <strong>{user?.displayName}</strong>
            {user?.isGuest && <span className="home-user-badge">guest</span>}
            <button
              type="button"
              className="home-name-edit-btn"
              onClick={startEditing}
              title="Change display name"
              aria-label="Edit display name"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </span>
        )}
        {!editing && (
          <button type="button" className="btn small" onClick={handleLogout}>
            Sign out
          </button>
        )}
      </div>

      <div className="panel">
        <h2>Get started</h2>
        <div className="actions">
          <Link className="btn primary" to="/create">
            Create table
          </Link>
          <button className="btn secondary" type="button" onClick={() => navigate('/join')}>
            Join with code
          </button>
        </div>
      </div>

      <footer className="disclaimer">
        Entertainment only. Play-money chips — no real-money wagering in this app.
      </footer>
    </div>
  );
}
