import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { DataSaverProvider } from './contexts/DataSaverContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ErrorBoundary from './components/ui/ErrorBoundary'
import './index.css'
import 'katex/dist/katex.min.css'
import './editor/editor.css'

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
