import time

import win32clipboard


def clipboard_copy(text):
    # WebView2 silently swallows navigator.clipboard / execCommand copy
    # under the app's file:// origin (no permission prompt is wired up),
    # so copy goes through the native Win32 clipboard instead.
    # OpenClipboard can transiently fail with "Access is denied" if another
    # process (or the OS itself) briefly holds the clipboard lock — retry.
    last_error = None
    for attempt in range(6):
        try:
            win32clipboard.OpenClipboard()
            try:
                win32clipboard.EmptyClipboard()
                win32clipboard.SetClipboardText(text, win32clipboard.CF_UNICODETEXT)
            finally:
                win32clipboard.CloseClipboard()
            return {"ok": True}
        except Exception as e:
            last_error = f"{type(e).__name__}: {e}"
            time.sleep(0.05 * (attempt + 1))
    return {"ok": False, "error": last_error}
