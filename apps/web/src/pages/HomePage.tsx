import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function HomePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="page home">
      <header className="hero">
        <h1>Virtual Card Table</h1>
        <p>Host home games online — shuffle, deal, and chips handled in-app. Settle up with friends IRL.</p>
      </header>

      <div className="panel home-identity-panel">
        <span className="home-user-name">
          Playing as <strong>{user?.displayName}</strong>
          {user?.isGuest && <span className="home-user-badge">guest</span>}
        </span>
        <button type="button" className="btn small" onClick={handleLogout}>
          Sign out
        </button>
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
