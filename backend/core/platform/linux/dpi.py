def get_dpi_scale(win):
    # Only used on Windows to position raw WinForms child controls in
    # physical pixels (see core/platform/windows/dpi.py) -- the Linux
    # browser implementation (features/browser/linux/window.py) doesn't do
    # manual pixel-perfect child-control positioning, so this is a true
    # no-op here.
    return 1.0
