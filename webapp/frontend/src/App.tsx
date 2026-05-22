import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import TrackerView from './components/TrackerView'
import RootFilesView from './components/RootFilesView'
import ProfilesView from './components/ProfilesView'
import SearchView from './components/SearchView'
import ApplicationView from './components/ApplicationView'
import HelpView from './components/HelpView'
import SetupView from './components/SetupView'
import SessionsView from './components/SessionsView'
import ChatPanel from './components/ChatPanel'
import { SessionProvider } from './context/SessionContext'

function AppLayout() {
  const location = useLocation()
  const hideChatPanel = location.pathname === '/sessions'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col">
        <div className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<TrackerView />} />
            <Route path="/files" element={<RootFilesView />} />
            <Route path="/profiles" element={<ProfilesView />} />
            <Route path="/profiles/:profile" element={<ProfilesView />} />
            <Route path="/ingestion" element={<SearchView />} />
            <Route path="/sessions" element={<SessionsView />} />
            <Route path="/applications/:folder" element={<ApplicationView />} />
            <Route path="/help" element={<HelpView />} />
            <Route path="/setup" element={<SetupView />} />
            {/* Legacy redirects */}
            <Route path="/search" element={<Navigate to="/ingestion" replace />} />
            <Route path="/docs" element={<Navigate to="/help" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
      {!hideChatPanel && <ChatPanel />}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <AppLayout />
      </SessionProvider>
    </BrowserRouter>
  )
}
