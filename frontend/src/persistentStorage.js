// Dev Hub runs pywebview in its default "private" mode: the embedded browser forgets its
// localStorage every time the app closes (and the page is served from a random port, so it
// would be a new origin each launch anyway). Everything the UI keeps there — open tabs,
// selected project, Code tabs, last test command, … — was lost on restart.
//
// This mirrors localStorage into a file owned by the Python side: it is loaded back before
// the app renders, and every later write is forwarded (debounced). The rest of the code
// keeps using plain localStorage and never knows.

const FLUSH_MS = 300
let pending = {}
let timer = null

function bridge() {
  const a = window.pywebview?.api
  return typeof a?.kv_load === 'function' && typeof a?.kv_set_many === 'function' ? a : null
}

function flush() {
  timer = null
  const changes = pending
  pending = {}
  if (!Object.keys(changes).length) return
  try {
    bridge()?.kv_set_many(changes)
  } catch {
    // the window is closing
  }
}

function queue(key, value) {
  pending[key] = value
  if (!timer) timer = setTimeout(flush, FLUSH_MS)
}

function waitForBridge(timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    const check = () => {
      if (bridge()) return resolve(true)
      if (Date.now() - started > timeoutMs) return resolve(false)
      setTimeout(check, 50)
    }
    check()
  })
}

export async function hydrateStorage() {
  // The bridge shows up a moment after the page starts. In a plain browser (npm run dev)
  // it never does: the wait is then the only cost.
  await waitForBridge(4000)
  if (!bridge()) return
  try {
    const saved = (await bridge().kv_load()) || {}
    for (const [key, value] of Object.entries(saved)) {
      if (typeof value === 'string' && localStorage.getItem(key) === null) localStorage.setItem(key, value)
    }
  } catch {
    // start with what the page has
  }

  // From now on every write goes to the file as well.
  const proto = Storage.prototype
  const set = proto.setItem
  const remove = proto.removeItem
  const clear = proto.clear
  proto.setItem = function (key, value) {
    set.call(this, key, value)
    if (this === window.localStorage) queue(String(key), String(value))
  }
  proto.removeItem = function (key) {
    remove.call(this, key)
    if (this === window.localStorage) queue(String(key), null)
  }
  proto.clear = function () {
    if (this === window.localStorage) for (let i = 0; i < this.length; i++) queue(this.key(i), null)
    clear.call(this)
  }
  window.addEventListener('beforeunload', flush)
  window.addEventListener('pagehide', flush)
}
