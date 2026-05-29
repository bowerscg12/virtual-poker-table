import { Link, useNavigate } from 'react-router-dom';

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="page home">
      <header className="hero">
        <h1>Virtual Card Table</h1>
        <p>Host home games online — shuffle, deal, and chips handled in-app. Settle up with friends IRL.</p>
      </header>

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
