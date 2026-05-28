import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function HomePage() {
  const { user, loginGuest } = useAuth();
  const [name, setName] = useState('');
  const navigate = useNavigate();

  async function handleGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await loginGuest(name.trim());
  }

  return (
    <div className="page home">
      <header className="hero">
        <h1>Virtual Card Table</h1>
        <p>Host home games online — shuffle, deal, and chips handled in-app. Settle up with friends IRL.</p>
      </header>

      {!user ? (
        <form className="card" onSubmit={handleGuest}>
          <h2>Join as guest</h2>
          <input
            placeholder="Your display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
          />
          <button type="submit">Continue</button>
        </form>
      ) : (
        <>
          <p className="welcome">Welcome, {user.displayName}</p>
          <div className="actions">
            <Link className="btn primary" to="/create">
              Create table
            </Link>
            <button className="btn secondary" type="button" onClick={() => navigate('/join/')}>
              Join with code
            </button>
          </div>
        </>
      )}

      <footer className="disclaimer">
        Entertainment only. Play-money chips — no real-money wagering in this app.
      </footer>
    </div>
  );
}
