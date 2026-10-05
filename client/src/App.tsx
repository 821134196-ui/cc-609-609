import { Navigate, Route, Routes } from 'react-router-dom';
import VoyagesPage from './pages/VoyagesPage';
import VoyageLayout from './pages/VoyageLayout';
import WatchPage from './pages/WatchPage';
import GatePage from './pages/GatePage';
import AgentPage from './pages/AgentPage';
import EventsPage from './pages/EventsPage';
import DeparturePage from './pages/DeparturePage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<VoyagesPage />} />
      <Route path="/v/:id" element={<VoyageLayout />}>
        <Route index element={<Navigate to="watch" replace />} />
        <Route path="watch" element={<WatchPage />} />
        <Route path="gate" element={<GatePage />} />
        <Route path="agent" element={<AgentPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="departure" element={<DeparturePage />} />
      </Route>
    </Routes>
  );
}
