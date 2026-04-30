import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { DataSaverProvider } from './contexts/DataSaverContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ErrorBoundary from './components/ui/ErrorBoundary'
import { initNativeShell } from './utils/nativeShell'
import './index.css'

initNativeShell()
// editor.css and katex CSS are imported from the editor/viewer entry modules
// (QuizEditor, QuizViewer, QuizPreview via safeRender). Keeping them out of the
// root entry trims ~50 KB of parse-time CSS on public pages.

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <DataSaverProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </DataSaverProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
