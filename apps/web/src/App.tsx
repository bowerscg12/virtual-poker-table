import { type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useSettings } from './hooks/useSettings';
import { useClickSound } from './hooks/useClickSound';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import CreateLobbyPage from './pages/CreateLobbyPage';
import JoinLobbyPage from './pages/JoinLobbyPage';
import WatchLobbyPage from './pages/WatchLobbyPage';
import NameSelectionPage from './pages/NameSelectionPage';
import TablePage from './pages/TablePage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import TournamentsPage from './pages/TournamentsPage';
import CreateTournamentPage from './pages/CreateTournamentPage';
import TournamentLobbyPage from './pages/TournamentLobbyPage';

function AppShell({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  useClickSound(settings.soundEffects);
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return null;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/watch/:code" element={<WatchLobbyPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
        <Route path="/create" element={<ProtectedRoute><CreateLobbyPage /></ProtectedRoute>} />
        <Route path="/join" element={<ProtectedRoute><JoinLobbyPage /></ProtectedRoute>} />
        <Route path="/join/:code" element={<ProtectedRoute><JoinLobbyPage /></ProtectedRoute>} />
        <Route path="/name" element={<ProtectedRoute><NameSelectionPage /></ProtectedRoute>} />
        <Route path="/lobby/:lobbyId/name" element={<ProtectedRoute><NameSelectionPage /></ProtectedRoute>} />
        <Route path="/table/:lobbyId" element={<ProtectedRoute><TablePage /></ProtectedRoute>} />
        <Route path="/tournaments" element={<ProtectedRoute><TournamentsPage /></ProtectedRoute>} />
        <Route path="/tournaments/create" element={<ProtectedRoute><CreateTournamentPage /></ProtectedRoute>} />
        <Route path="/tournaments/:id" element={<ProtectedRoute><TournamentLobbyPage /></ProtectedRoute>} />
      </Routes>
      </AppShell>
    </AuthProvider>
  );
}
