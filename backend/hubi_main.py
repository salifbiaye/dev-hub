"""Run Hubi on its own, without Dev Hub's main window — handy to iterate on
the eyes: `python backend/hubi_main.py`. Needs no `npm run build`: the widget
page is plain files served straight from frontend/public."""
import sys
from pathlib import Path

import webview

from core.server.static_server import serve_own_ui
from features.hubi import api as hubi_api
from features.hubi import window as hubi_window


def main():
    public_dir = Path(__file__).parent.parent / "frontend" / "public"
    port = serve_own_ui(public_dir)
    hubi_window.set_enabled_flag(True)
    hubi_api.start(f"http://localhost:{port}")
    webview.start()
    hubi_api.stop()
    sys.exit(0)


if __name__ == "__main__":
    main()
