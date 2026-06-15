/* Public surface of the Visual Studio feature. The whole studio lives under
   src/features/visualStudio/ and is reachable through this single entry point,
   which keeps the rest of the app decoupled from its internals (and eases the
   future standalone-app extraction). */

export { default as VisualStudioPage } from './pages/VisualStudioPage'
