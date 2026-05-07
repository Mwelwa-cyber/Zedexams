// src/features/notes/components/NoteEditor.jsx
//
// Rich-text editor for note content. Uses @tiptap/react directly with
// the same extension factory the quiz editor uses, so notes look and
// behave like other rich-text in the app (math, tables, etc.).
//
// Stores HTML strings in Firestore (matches the firestore.rules
// `content` validator: string, max 200KB). The editor's getHTML()
// is the single conversion point.
//
// Inline image upload: extends buildExtensions with the Image node,
// adds a small "Insert image" button next to the toolbar, and intercepts
// pasted/dropped images. Each image lands in Storage at
// lesson-files/{ownerUid}/{assetBatchId}/inline/... and the resulting
// URL is inserted into the editor. Disabled until ownerUid +
// assetBatchId are available (the parent generates assetBatchId early
// for new notes so users don't have to save first).

import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import Image from '@tiptap/extension-image'
import EditorToolbar from '../../../editor/components/EditorToolbar'
import MathModal from '../../../editor/components/modals/MathModal'
import TableModal from '../../../editor/components/modals/TableModal'
import { buildExtensions } from '../../../editor/extensions/buildExtensions'
import { sanitizePastedHTML } from '../../../editor/utils/sanitize'
import { uploadInlineImage } from '../lib/storage'
import { ImageIcon, Loader2 } from '../../../components/ui/icons'
import 'katex/dist/katex.min.css'
import '../../../editor/editor.css'

export function NoteEditor({
  value,
  onChange,
  ownerUid,
  assetBatchId,
  placeholder = 'Start typing your note…',
}) {
  const [showMath,  setShowMath]  = useState(false)
  const [showTable, setShowTable] = useState(false)
  const [mathEdit,  setMathEdit]  = useState(null)
  const [imgUploading, setImgUploading] = useState(false)
  const [imgError, setImgError] = useState(null)
  const fileInputRef = useRef(null)

  const canUploadImage = !!ownerUid && !!assetBatchId

  // Stable refs so the editor isn't re-created when parent re-renders.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  const ownerUidRef     = useRef(ownerUid)
  const assetBatchIdRef = useRef(assetBatchId)
  useEffect(() => { ownerUidRef.current     = ownerUid     }, [ownerUid])
  useEffect(() => { assetBatchIdRef.current = assetBatchId }, [assetBatchId])

  // Memoise the initial value so subsequent parent re-renders don't reset
  // the editor mid-edit. Tiptap accepts HTML strings as `content`.
  const initialContentRef = useRef(value ?? '')

  // Upload a File via Firebase Storage; resolves to a public URL.
  const uploadImageFile = useCallback(async (file) => {
    if (!ownerUidRef.current || !assetBatchIdRef.current) {
      throw new Error('Save the note first, then add images.')
    }
    return uploadInlineImage({
      ownerUid: ownerUidRef.current,
      assetBatchId: assetBatchIdRef.current,
      file,
    })
  }, [])

  const editor = useEditor({
    extensions: [
      ...buildExtensions({ placeholder, readOnly: false }),
      Image.configure({ inline: false, allowBase64: false, HTMLAttributes: { class: 'note-inline-image' } }),
    ],
    content: initialContentRef.current || '<p></p>',
    editorProps: {
      attributes: {
        class: 'editor-area prose-note',
        'data-placeholder': placeholder,
      },
      transformPastedHTML: sanitizePastedHTML,
      // Intercept images dropped onto the editor and route them through Storage.
      handleDrop(view, event, _slice, moved) {
        if (moved) return false
        const files = Array.from(event.dataTransfer?.files || [])
        const images = files.filter(f => f.type.startsWith('image/'))
        if (images.length === 0) return false
        event.preventDefault()
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
        ;(async () => {
          for (const file of images) {
            try {
              setImgUploading(true)
              setImgError(null)
              const url = await uploadImageFile(file)
              const node = view.state.schema.nodes.image.create({ src: url })
              const tr = view.state.tr.insert(coords?.pos ?? view.state.doc.content.size, node)
              view.dispatch(tr)
            } catch (err) {
              console.error('drop image upload failed', err)
              setImgError(err.message || 'Image upload failed.')
            } finally {
              setImgUploading(false)
            }
          }
        })()
        return true
      },
      // Intercept pasted images from the clipboard.
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items || [])
        const imageItem = items.find(i => i.type.startsWith('image/'))
        if (!imageItem) return false
        const file = imageItem.getAsFile()
        if (!file) return false
        event.preventDefault()
        ;(async () => {
          try {
            setImgUploading(true)
            setImgError(null)
            const url = await uploadImageFile(file)
            const node = view.state.schema.nodes.image.create({ src: url })
            view.dispatch(view.state.tr.replaceSelectionWith(node))
          } catch (err) {
            console.error('paste image upload failed', err)
            setImgError(err.message || 'Image upload failed.')
          } finally {
            setImgUploading(false)
          }
        })()
        return true
      },
    },
    onUpdate({ editor: ed }) {
      onChangeRef.current?.(ed.getHTML())
    },
  })

  // Math node click-to-edit — same wiring RichEditor uses.
  useEffect(() => {
    if (!editor?.isInitialized) return
    const dom = editor.view.dom
    const handleMathClick = (e) => {
      setMathEdit({ latex: e.detail.latex, pos: e.detail.pos })
      setShowMath(true)
    }
    dom.addEventListener('tiptap-math-click', handleMathClick)
    return () => dom.removeEventListener('tiptap-math-click', handleMathClick)
  }, [editor, editor?.isInitialized])

  // Late-arriving content (e.g. async note load): push it in only if the
  // editor is currently empty so we don't fight the user's typing.
  useEffect(() => {
    if (!editor) return
    if (editor.isEmpty && value && value !== editor.getHTML()) {
      editor.commands.setContent(value, { emitUpdate: false })
    }
  }, [editor, value])

  const handleOpenMath  = useCallback(() => { setMathEdit(null); setShowMath(true) }, [])
  const handleOpenTable = useCallback(() => setShowTable(true), [])
  const handleCloseMath = useCallback(() => { setShowMath(false); setMathEdit(null) }, [])

  const handlePickImage = useCallback(() => {
    if (!canUploadImage || imgUploading) return
    fileInputRef.current?.click()
  }, [canUploadImage, imgUploading])

  const handleImageFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !editor) return
    setImgUploading(true)
    setImgError(null)
    try {
      const url = await uploadImageFile(file)
      editor.chain().focus().setImage({ src: url }).run()
    } catch (err) {
      console.error('image upload failed', err)
      setImgError(err.message || 'Image upload failed.')
    } finally {
      setImgUploading(false)
    }
  }, [editor, uploadImageFile])

  return (
    <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
      <div className="re-wrap">
        <EditorToolbar
          editor={editor}
          onMath={handleOpenMath}
          onTable={handleOpenTable}
        />
        <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-neutral-100 bg-neutral-50/60">
          <button
            type="button"
            onClick={handlePickImage}
            disabled={!canUploadImage || imgUploading}
            className="text-xs px-2.5 py-1.5 rounded-md border border-neutral-200 hover:bg-white transition inline-flex items-center gap-1.5 text-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title={canUploadImage ? 'Insert image (or paste / drop one)' : 'Save the note first to enable images'}
          >
            {imgUploading ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
            {imgUploading ? 'Uploading…' : 'Insert image'}
          </button>
          {imgError && (
            <span className="text-xs text-red-600 truncate" title={imgError}>{imgError}</span>
          )}
          {!imgError && !canUploadImage && (
            <span className="text-[11px] text-neutral-400">Images activate after the first save</span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={handleImageFile}
        />
        <EditorContent editor={editor} style={{ minHeight: 400 }} />
      </div>

      {showMath && (
        <MathModal
          editor={editor}
          editState={mathEdit}
          onClose={handleCloseMath}
        />
      )}
      {showTable && (
        <TableModal
          editor={editor}
          onClose={() => setShowTable(false)}
        />
      )}
    </div>
  )
}
