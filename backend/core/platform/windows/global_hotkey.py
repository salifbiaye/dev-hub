"""A system-wide hotkey (RegisterHotKey) on its own thread + message loop."""
import ctypes
import ctypes.wintypes as wintypes
import threading

_WM_HOTKEY = 0x0312
_WM_QUIT = 0x0012
_MOD_ALT = 0x0001
_MOD_CONTROL = 0x0002
_MOD_SHIFT = 0x0004
_MOD_NOREPEAT = 0x4000

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32


def _parse(combo):
    mods, vk = _MOD_NOREPEAT, None
    for part in combo.lower().split("+"):
        part = part.strip()
        if part in ("ctrl", "control"):
            mods |= _MOD_CONTROL
        elif part == "alt":
            mods |= _MOD_ALT
        elif part == "shift":
            mods |= _MOD_SHIFT
        elif len(part) == 1 and part.isalnum():
            vk = ord(part.upper())
        elif part in ("esc", "escape"):
            vk = 0x1B
        elif part.startswith("f") and part[1:].isdigit():
            vk = 0x70 + int(part[1:]) - 1
    return mods, vk


def start(combo, callback):
    """Register `combo` (e.g. "ctrl+alt+h"). Returns a stop() function, or
    None if the combination is unavailable (already taken by another app)."""
    mods, vk = _parse(combo)
    if vk is None:
        return None
    ready = threading.Event()
    state = {"ok": False, "thread_id": None}

    def loop():
        state["thread_id"] = kernel32.GetCurrentThreadId()
        state["ok"] = bool(user32.RegisterHotKey(None, 1, mods, vk))
        ready.set()
        if not state["ok"]:
            return
        msg = wintypes.MSG()
        try:
            while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                if msg.message == _WM_HOTKEY:
                    try:
                        callback()
                    except Exception:
                        pass
        finally:
            user32.UnregisterHotKey(None, 1)

    threading.Thread(target=loop, daemon=True, name=f"hotkey-{combo}").start()
    ready.wait(2.0)
    if not state["ok"]:
        return None

    def stop():
        user32.PostThreadMessageW(state["thread_id"], _WM_QUIT, 0, 0)

    return stop
