import { useEffect, useRef, useState } from 'react'
import { IconPencil } from './icons'

// Custom icons for projects and groups: a picture picked from disk, shrunk here to a small
// PNG (a few KB) and kept as a data URL in Dev Hub's config. Shown like a favicon: in the
// project's browser-style tab, its header and the lists, in place of the default folder.

// Big enough to stay sharp in the Aperçu tab (13 rem, so up to ~400 px on a scaled display);
// WebP keeps the transparency at a fraction of PNG's weight (a photo is ~30 KB).
const SIZE = 320

// Halves the image step by step while it is more than twice the target: one big jump
// down makes browsers skip pixels (jagged, soft result).
function downscale(img, w, h) {
  let src = img
  let sw = img.naturalWidth || w
  let sh = img.naturalHeight || h
  while (sw / 2 >= w && sh / 2 >= h) {
    const c = document.createElement('canvas')
    c.width = Math.round(sw / 2)
    c.height = Math.round(sh / 2)
    const g = c.getContext('2d')
    g.imageSmoothingQuality = 'high'
    g.drawImage(src, 0, 0, c.width, c.height)
    src = c
    sw = c.width
    sh = c.height
  }
  return src
}

// File -> square WebP data URL (aspect ratio kept, transparent margins).
export function fileToIcon(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type?.startsWith('image/')) return reject(new Error("Ce fichier n'est pas une image"))
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Lecture du fichier impossible'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Image illisible'))
      img.onload = () => {
        const nw = img.naturalWidth || SIZE
        const nh = img.naturalHeight || SIZE
        // Never blow a small image up past its own size: it would only get blurrier.
        const scale = Math.min(SIZE / nw, SIZE / nh, 1)
        const w = Math.max(1, Math.round(nw * scale))
        const h = Math.max(1, Math.round(nh * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(downscale(img, w, h), 0, 0, w, h)
        resolve(canvas.toDataURL('image/webp', 0.9))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// The icon in a small box: the picture as is, or the default glyph on the accent tint.
export function IconBox({ icon, fallback, className = '' }) {
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden ${icon ? '' : 'bg-accent-bg text-accent'} ${className}`}>
      {icon ? <img src={icon} alt="" draggable={false} className="h-full w-full object-contain" /> : fallback}
    </span>
  )
}

// Same box, clickable: choose a picture or remove it.
export function EditableIcon({ icon, fallback, onChange, onError, className = '', title = "Changer l'icône" }) {
  const [open, setOpen] = useState(false)
  const fileRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => !wrapRef.current?.contains(e.target) && setOpen(false)
    window.addEventListener('mousedown', away)
    return () => window.removeEventListener('mousedown', away)
  }, [open])

  async function picked(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    setOpen(false)
    if (!file) return
    try {
      onChange(await fileToIcon(file))
    } catch (err) {
      onError?.(err.message)
    }
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button type="button" title={title} onClick={() => setOpen((v) => !v)} className="group/icon relative block cursor-pointer rounded-lg">
        <IconBox icon={icon} fallback={fallback} className={className} />
        <span className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-black/55 text-white opacity-0 transition-opacity group-hover/icon:opacity-100">
          <IconPencil className="h-3.5 w-3.5" />
        </span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={picked} />
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-52 rounded-md border border-border-strong bg-surface p-1 shadow-xl">
          <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full cursor-pointer items-center rounded px-2.5 py-1.5 text-left text-[12.5px] text-text hover:bg-surface-hover">
            Choisir une image…
          </button>
          {icon && (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onChange(null)
              }}
              className="flex w-full cursor-pointer items-center rounded px-2.5 py-1.5 text-left text-[12.5px] text-muted hover:bg-surface-hover hover:text-danger"
            >
              Retirer l'icône
            </button>
          )}
          <p className="px-2.5 pb-1 pt-1.5 text-[10.5px] leading-snug text-muted">PNG, JPG, SVG, WebP… Redimensionnée automatiquement (nette jusqu'à ~300 px).</p>
        </div>
      )}
    </div>
  )
}
