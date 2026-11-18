// A framed empty state: Hubi, dimmed and tilted, with a title and a line of help.
// Same mascot treatment as the file viewer's "Oups…" (App.jsx FileNotice).
export function EmptyState({ title, children, pulse = false, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-8 text-center ${className}`}>
      <img
        src="/hubi/hubi-icon.png"
        alt=""
        draggable={false}
        className={`mb-1 h-14 w-20 -rotate-6 object-contain opacity-35 grayscale ${pulse ? 'animate-pulse' : ''}`}
      />
      <p className="text-[13px] font-semibold text-text">{title}</p>
      {children && <p className="max-w-xs text-[12px] leading-relaxed text-muted">{children}</p>}
    </div>
  )
}
