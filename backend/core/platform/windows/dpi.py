import ctypes


def get_dpi_scale(form):
    # rect coordinates from the frontend come in logical/CSS pixels, but
    # Control.Bounds on a DPI-aware WinForms control expects physical
    # pixels. Same conversion pywebview's own move()/resize() already do
    # (see winforms.py's _scale property).
    if form is None:
        return 1.0
    try:
        return ctypes.windll.user32.GetDpiForWindow(form.Handle.ToInt32()) / 96
    except Exception:
        return 1.0
