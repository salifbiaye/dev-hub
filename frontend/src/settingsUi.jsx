import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconChevronDown } from './icons'

// Building blocks of the settings pages, after Apple's grouped lists: flat
// rows in a rounded group, hairline separators inset from the text, small
// gray section titles and footnotes — no bordered cards, no stacked buttons.

export function Section({ title, footer, children }) {
  return (
    <section className="flex flex-col gap-1.5">
      {title && <h3 className="px-4 text-[12px] font-medium uppercase tracking-wide text-muted">{title}</h3>}
      <div className="flex flex-col gap-3">{children}</div>
      {footer && <p className="px-4 text-[12px] leading-snug text-muted">{footer}</p>}
    </section>
  )
}

export function Group({ children }) {
  return <div className="overflow-hidden rounded-[10px] bg-surface">{children}</div>
}

const TONES = { accent: 'text-accent', danger: 'text-danger', muted: 'text-muted' }

/**
 * One line of a group. Clickable when `onClick` is given. `inset` aligns the
 * separator with the text after a leading icon; `children` is custom content
 * (an input) placed after the title.
 */
export function Row({ leading, title, subtitle, right, onClick, inset = false, tone, mono = false, disabled = false, children }) {
  const clickable = !!onClick && !disabled
  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={
        clickable
          ? onClick
          : children
            ? (e) => {
                // A row holding a field: a click anywhere on the line focuses it.
                const field = e.currentTarget.querySelector('input,select,textarea')
                if (field && e.target !== field) field.focus()
              }
            : undefined
      }
      onKeyDown={
        clickable
          ? (e) => {
              if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                onClick(e)
              }
            }
          : undefined
      }
      className={`group/row relative flex min-h-[46px] w-full items-center gap-3 px-4 py-2 text-left text-[14px] after:absolute after:bottom-0 after:right-0 after:h-px after:bg-border/70 last:after:hidden ${
        inset ? 'after:left-[64px]' : 'after:left-4'
      } ${clickable ? 'cursor-pointer outline-none transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover' : ''} ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      {(title || subtitle) && (
        <span className={`min-w-0 ${children ? 'w-[120px] flex-none' : 'flex-1'}`}>
          <span className={`block truncate ${mono ? 'font-mono text-[13px]' : ''} ${TONES[tone] || 'text-text'}`}>{title}</span>
          {subtitle && <span className="block truncate text-[12px] leading-snug text-muted">{subtitle}</span>}
        </span>
      )}
      {children}
      {right && <span className="flex shrink-0 items-center gap-2 text-[13.5px] text-muted">{right}</span>}
    </div>
  )
}

/** Text field inside a row: right-aligned value, no box. */
export function RowInput({ align = 'right', mono = false, className = '', ...props }) {
  return (
    <input
      {...props}
      className={`min-w-0 flex-1 bg-transparent text-[13.5px] text-text outline-none placeholder:text-muted/60 ${
        align === 'right' ? 'text-right' : ''
      } ${mono ? 'font-mono text-[13px]' : ''} ${className}`}
    />
  )
}

export function Switch({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[24px] w-[42px] shrink-0 cursor-pointer rounded-full transition-colors duration-200 disabled:cursor-default disabled:opacity-60 ${
        checked ? 'bg-success' : 'bg-border-strong'
      }`}
    >
      <span
        className={`absolute left-[2px] top-[2px] h-[20px] w-[20px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-transform duration-200 ${
          checked ? 'translate-x-[18px]' : ''
        }`}
      />
    </button>
  )
}

/** Apple-style segmented control. options: [{ value, label, Logo? }]. */
export function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex shrink-0 rounded-[9px] bg-base/70 p-0.5 ring-1 ring-border">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex cursor-pointer items-center gap-1.5 rounded-[7px] px-2.5 py-1 text-[12.5px] font-medium transition-colors duration-150 ${
              active ? 'bg-surface-hover text-text shadow-sm ring-1 ring-border-strong' : 'text-muted hover:text-text'
            }`}
          >
            {o.Logo && <o.Logo className="h-3.5 w-3.5 shrink-0" />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Value picker shown as quiet text with a chevron (native menu on click). */
// Not a native <select>: under WebView2 its popup ignores the dark theme.
export function SelectField({ value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', close, true)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', close, true)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const current = options.find((o) => o.value === value)
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1.5 rounded-md py-1 pl-2 pr-1 text-[13.5px] text-muted outline-none transition-colors hover:text-text"
      >
        {current?.label ?? value}
        <IconChevronDown className={`h-3 w-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          // fixed: the group around the row clips anything that overflows it
          style={{
            position: 'fixed',
            top: (ref.current?.getBoundingClientRect().bottom ?? 0) + 4,
            right: window.innerWidth - (ref.current?.getBoundingClientRect().right ?? 0),
          }}
          className="z-30 min-w-[160px] overflow-hidden rounded-[10px] border border-border-strong bg-surface p-1 shadow-xl"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-hover ${
                o.value === value ? 'text-accent' : 'text-text'
              }`}
            >
              {o.label}
              {o.value === value && <IconCheck className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Rounded-square app icon, like the ones in Settings. */
export function AppIcon({ children, size = 36 }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center bg-base ring-1 ring-border"
      style={{ width: size, height: size, borderRadius: size * 0.27 }}
    >
      {children}
    </span>
  )
}
