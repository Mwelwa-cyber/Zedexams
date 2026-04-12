import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { DataSaverProvider } from './contexts/DataSaverContext'
import { ThemeProvider } from './contexts/ThemeContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <DataSaverProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </DataSaverProvider>
    </ThemeProvider>
  </React.StrictMode>
)
