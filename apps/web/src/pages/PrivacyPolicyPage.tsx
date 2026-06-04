import { Link } from 'react-router-dom';

export default function PrivacyPolicyPage() {
  return (
    <div className="page privacy-policy">
      <header className="hero">
        <h1>Virtual Card Table</h1>
        <p className="hero-sub">Privacy Policy</p>
      </header>

      <div className="panel privacy-panel">
        <p className="policy-effective">Effective: June 4, 2026</p>

        <p>
          Virtual Card Table ("the App," "we," "us") is a browser-based, play-money card game
          operated by an individual developer. This policy explains what personal data we collect,
          how we use it, and your rights.
        </p>

        <h2>1. Contact</h2>
        <p>
          For any privacy-related requests or questions, email:{' '}
          <a href="mailto:cbowers1221@gmail.com">cbowers1221@gmail.com</a>. We will respond within
          30 days.
        </p>

        <h2>2. Data We Collect</h2>
        <table className="policy-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>When collected</th>
              <th>Purpose</th>
              <th>Required?</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Display name</td>
              <td>Account creation or guest play</td>
              <td>Shown to other players at the table</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Username</td>
              <td>Account registration</td>
              <td>Login credential only — not displayed to other players</td>
              <td>No (guest play requires no username)</td>
            </tr>
            <tr>
              <td>Password</td>
              <td>Account registration</td>
              <td>Authentication — stored as a one-way bcrypt hash; we never see the plaintext</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Avatar configuration</td>
              <td>When you customize your avatar</td>
              <td>Displayed at the table</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Game &amp; hand history</td>
              <td>During play</td>
              <td>In-game results display and session stats</td>
              <td>Automatic during play</td>
            </tr>
            <tr>
              <td>Session ID</td>
              <td>On connection</td>
              <td>Reconnects your browser if your connection drops</td>
              <td>Automatic</td>
            </tr>
            <tr>
              <td>IP address</td>
              <td>Every request</td>
              <td>Rate limiting only — not stored after the request completes</td>
              <td>Implicit</td>
            </tr>
          </tbody>
        </table>

        <p>
          Authentication tokens (JWT) and your reconnection session ID are stored in your
          browser's <code>localStorage</code>. We do not use cookies.
        </p>

        <h2>3. How We Use Your Data</h2>
        <ul>
          <li>To authenticate your account and maintain your session</li>
          <li>To run the game (deal cards, track chips, record hand results)</li>
          <li>To prevent abuse via rate limiting</li>
        </ul>
        <p>We do not use your data for advertising, profiling, or any purpose not listed above.</p>

        <h2>4. What We Do Not Do</h2>
        <ul>
          <li>We do not sell, rent, or share your personal data with any third party</li>
          <li>We do not send marketing or promotional communications</li>
          <li>We do not use analytics, advertising, or behavioral tracking services</li>
          <li>We do not use browser cookies</li>
        </ul>

        <h2>5. Data Retention</h2>
        <ul>
          <li>
            Registered accounts and their data are retained until you request deletion or the
            account is inactive for an extended period
          </li>
          <li>
            Guest accounts and their associated game data may be automatically deleted after 90
            days of inactivity
          </li>
          <li>
            Reconnection session tokens expire automatically within 3 hours of disconnection
          </li>
          <li>IP addresses used for rate limiting are not persisted to disk</li>
        </ul>

        <h2>6. Your Rights</h2>
        <p>
          Depending on where you live, you may have the right to access, correct, or delete the
          personal data we hold about you, or to object to or restrict its processing. To exercise
          any of these rights, email{' '}
          <a href="mailto:cbowers1221@gmail.com">cbowers1221@gmail.com</a>.
        </p>

        <div className="policy-jurisdiction">
          <h3>European Union (GDPR)</h3>
          <p>
            Our legal basis for processing your data is performance of a contract — specifically,
            providing your game account and session. You have the right to lodge a complaint with
            your national data protection supervisory authority.
          </p>

          <h3>California Residents (CCPA / CPRA)</h3>
          <p>
            We do not sell personal information. The categories of personal information we collect
            are described in Section 2. You have the right to request disclosure of what we
            collect, request deletion, and to not be discriminated against for exercising these
            rights.
          </p>
        </div>

        <h2>7. Children's Privacy</h2>
        <p>
          The App is intended for users 13 years of age or older. We do not knowingly collect
          personal data from children under 13. If you believe a child under 13 has provided us
          with personal information, contact us at{' '}
          <a href="mailto:cbowers1221@gmail.com">cbowers1221@gmail.com</a> and we will delete it
          promptly.
        </p>

        <h2>8. Security</h2>
        <p>
          Passwords are stored using bcrypt hashing and are never stored in plaintext. All data is
          transmitted over HTTPS. Authentication tokens are stored in your browser's{' '}
          <code>localStorage</code> and are not accessible to other websites. While we take
          reasonable precautions, no system is completely secure and we cannot guarantee absolute
          security.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          If we make material changes to this policy, we will update the effective date at the top
          of this page. Continued use of the App after changes are posted constitutes your
          acceptance of the updated policy.
        </p>
      </div>

      <footer className="disclaimer">
        <Link to="/login">← Back</Link>
        &nbsp;&nbsp;·&nbsp;&nbsp;
        Entertainment only. Play-money chips — no real-money wagering in this app.
      </footer>
    </div>
  );
}
