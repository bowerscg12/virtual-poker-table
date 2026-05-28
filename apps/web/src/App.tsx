import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import HomePage from './pages/HomePage';
import CreateLobbyPage from './pages/CreateLobbyPage';
import JoinLobbyPage from './pages/JoinLobbyPage';
import TablePage from './pages/TablePage';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/create" element={<CreateLobbyPage />} />
        <Route path="/join/:code" element={<JoinLobbyPage />} />
        <Route path="/table/:lobbyId" element={<TablePage />} />
      </Routes>
    </AuthProvider>
  );
}
