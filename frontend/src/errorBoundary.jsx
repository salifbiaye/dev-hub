import { Component } from 'react'

// Without this, any error thrown while rendering unmounts the whole app and
// leaves an empty dark window — which the frame watchdog can't tell apart
// from a healthy page, since the page itself keeps running.
export class ErrorBoundary extends Component {
  state = { error: null, info: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    this.setState({ info })
    console.error('Dev Hub render error:', error, info?.componentStack)
  }

  render() {
    const { error, info } = this.state
    if (!error) return this.props.children
    const details = `${error?.stack || error}\n${info?.componentStack || ''}`.trim()
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-base p-8 text-center text-text">
        <img src="/hubi/hubi-icon.png" alt="" className="h-16 w-24 -rotate-6 object-contain opacity-35 grayscale" draggable={false} />
        <p className="text-base font-semibold">Oups… quelque chose a planté</p>
        <p className="max-w-xl text-xs text-muted">{String(error?.message || error)}</p>
        <div className="flex gap-2">
          <button
            onClick={() => location.reload()}
            className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover"
          >
            Recharger
          </button>
          <button
            onClick={() => navigator.clipboard?.writeText(details)}
            className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] text-text hover:bg-surface-hover"
          >
            Copier l'erreur
          </button>
        </div>
        <pre className="theme-scroll max-h-48 w-full max-w-2xl overflow-auto rounded-md border border-border bg-surface p-3 text-left font-mono text-[10.5px] text-muted">
          {details}
        </pre>
      </div>
    )
  }
}
