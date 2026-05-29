import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import HomePage from './pages/HomePage';
import CreateLobbyPage from './pages/CreateLobbyPage';
import JoinLobbyPage from './pages/JoinLobbyPage';
import NameSelectionPage from './pages/NameSelectionPage';
import TablePage from './pages/TablePage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create" element={<CreateLobbyPage />} />
        <Route path="/join" element={<JoinLobbyPage />} />
        <Route path="/join/:code" element={<JoinLobbyPage />} />
        {/* Name selection: /name for create flow, /lobby/:lobbyId/name for join flow */}
        <Route path="/name" element={<NameSelectionPage />} />
        <Route path="/lobby/:lobbyId/name" element={<NameSelectionPage />} />
        <Route path="/table/:lobbyId" element={<TablePage />} />
      </Routes>
    </AuthProvider>
  );
}
