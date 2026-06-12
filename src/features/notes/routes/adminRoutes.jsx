// src/features/notes/routes/adminRoutes.jsx
//
// Notes Studio admin route definitions. Mounted on /admin/lessons* paths
// to replace the previous slide-builder routes (PR #221's "Notes Studio"
// rebrand only renamed the UI label — content actually lived under
// /admin/lessons all along).
//
// App.jsx wraps each element in <AdminRoute> for the role check + sidebar
// layout. Keeping these here instead of inline so the feature owns its
// own route list.

import { AdminNotesList }   from '../pages/AdminNotesList'
import { AdminNoteEditor }  from '../pages/AdminNoteEditor'
import { AdminNoteImport }  from '../pages/AdminNoteImport'

export const adminNoteRouteDefs = [
  { path: '/admin/lessons',             element: <AdminNotesList /> },
  { path: '/admin/lessons/new',         element: <AdminNoteEditor /> },
  { path: '/admin/lessons/import',      element: <AdminNoteImport /> },
  { path: '/admin/lessons/:id/edit',    element: <AdminNoteEditor /> },
]
