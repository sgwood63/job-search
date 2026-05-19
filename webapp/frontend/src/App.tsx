import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import TrackerView from './components/TrackerView'
import RootFilesView from './components/RootFilesView'
import ProfilesView from './components/ProfilesView'
import BaseDocsView from './components/BaseDocsView'
import SearchView from './components/SearchView'
import ApplicationView from './components/ApplicationView'
import DocsView from './components/DocsView'
import SetupChat from './components/SetupChat'
import BottomPanel from './components/BottomPanel'

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-gray-50 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<TrackerView />} />
              <Route path="/files" element={<RootFilesView />} />
              <Route path="/profiles" element={<ProfilesView />} />
              <Route path="/profiles/:profile" element={<ProfilesView />} />
              <Route path="/base-docs" element={<BaseDocsView />} />
              <Route path="/search" element={<SearchView />} />
              <Route path="/applications/:folder" element={<ApplicationView />} />
              <Route path="/docs" element={<DocsView />} />
              <Route path="/setup" element={<SetupChat />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
          <BottomPanel />
        </main>
      </div>
    </BrowserRouter>
  )
}
