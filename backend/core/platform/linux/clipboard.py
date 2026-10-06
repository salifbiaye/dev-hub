import shutil
import subprocess


def _try_cli(args, text):
    try:
        result = subprocess.run(args, input=text, text=True, capture_output=True, timeout=5)
        if result.returncode == 0:
            return True, None
        return False, (result.stderr or "").strip() or f"exit code {result.returncode}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def clipboard_copy(text):
    # Same return shape as the Windows implementation
    # (core/platform/windows/clipboard.py): {"ok": True} / {"ok": False, "error": str}.
    # No single clipboard API works everywhere on Linux (X11 vs Wayland,
    # desktop environment differences), so this tries the common CLI tools
    # in order of availability, falling back to the pyperclip package if
    # neither xclip nor xsel is installed (or both fail at runtime).
    errors = []

    if shutil.which("xclip"):
        ok, err = _try_cli(["xclip", "-selection", "clipboard"], text)
        if ok:
            return {"ok": True}
        errors.append(f"xclip: {err}")

    if shutil.which("xsel"):
        ok, err = _try_cli(["xsel", "--clipboard", "--input"], text)
        if ok:
            return {"ok": True}
        errors.append(f"xsel: {err}")

    if not errors:
        errors.append("xclip/xsel introuvables")

    try:
        import pyperclip

        pyperclip.copy(text)
        return {"ok": True}
    except Exception as e:
        errors.append(f"pyperclip: {type(e).__name__}: {e}")
        return {"ok": False, "error": "; ".join(errors)}
