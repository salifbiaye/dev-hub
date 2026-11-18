import { useEffect, useRef, useState } from 'react'
import { IconChevronDown } from './icons'

// A dropdown that follows the app theme (the native <select> popup is drawn by the OS, white).
export function Select({ value, onChange, options, title, className = '', menuClassName = '', chevron = true, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const esc = (e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc, true)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc, true)
    }
  }, [open])
  const current = options.find((o) => o.value === value)
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" title={title} onClick={() => setOpen((v) => !v)} className={`flex w-full cursor-pointer items-center gap-2 text-left outline-none ${className}`}>
        <span className={`min-w-0 flex-1 truncate ${current?.color || ''}`}>{children || current?.label || value}</span>
        {chevron && <IconChevronDown className="h-3 w-3 shrink-0 text-muted" />}
      </button>
      {open && (
        <div className={`theme-scroll absolute left-0 top-full z-30 mt-1 max-h-64 min-w-full overflow-y-auto rounded-md border border-border-strong bg-surface p-1 shadow-xl ${menuClassName}`}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`flex w-full cursor-pointer items-center gap-2 whitespace-nowrap rounded px-2.5 py-1.5 text-left text-[12.5px] hover:bg-surface-hover ${o.value === value ? 'bg-surface-hover/60' : ''} ${o.color || 'text-text'}`}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.value === value && <span className="text-[10px] text-accent">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
