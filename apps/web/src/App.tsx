import { type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import CreateLobbyPage from './pages/CreateLobbyPage';
import JoinLobbyPage from './pages/JoinLobbyPage';
import NameSelectionPage from './pages/NameSelectionPage';
import TablePage from './pages/TablePage';

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
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
        <Route path="/create" element={<ProtectedRoute><CreateLobbyPage /></ProtectedRoute>} />
        <Route path="/join" element={<ProtectedRoute><JoinLobbyPage /></ProtectedRoute>} />
        <Route path="/join/:code" element={<ProtectedRoute><JoinLobbyPage /></ProtectedRoute>} />
        <Route path="/name" element={<ProtectedRoute><NameSelectionPage /></ProtectedRoute>} />
        <Route path="/lobby/:lobbyId/name" element={<ProtectedRoute><NameSelectionPage /></ProtectedRoute>} />
        <Route path="/table/:lobbyId" element={<ProtectedRoute><TablePage /></ProtectedRoute>} />
      </Routes>
    </AuthProvider>
  );
}
