import json
import re
import urllib.parse

from app_config import APP_DATA_DIR

_THEME_VAR_NAMES = [
    "base", "surface", "surface-hover", "border", "border-strong",
    "text", "muted", "accent", "accent-hover", "danger",
]

# Dimensions/UA strings mirror Chrome DevTools' own built-in device list
# (the reference the feature request pointed at) closely enough for
# responsive-layout and UA-sniffing testing purposes -- exact browser point
# version in the UA string doesn't need to be current, just plausible.
DEVICE_PRESETS = {
    "iphone14": {
        "label": "iPhone 14", "width": 390, "height": 844,
        "ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 "
              "(KHTML, like Gecko) CriOS/105.0.5195.100 Mobile/15E148 Safari/604.1",
    },
    "iphonese": {
        "label": "iPhone SE", "width": 375, "height": 667,
        "ua": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4 like Mac OS X) AppleWebKit/605.1.15 "
              "(KHTML, like Gecko) CriOS/100.0.4896.75 Mobile/15E148 Safari/604.1",
    },
    "ipad": {
        "label": "iPad", "width": 820, "height": 1180,
        "ua": "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 "
              "(KHTML, like Gecko) CriOS/105.0.5195.100 Mobile/15E148 Safari/604.1",
    },
    "pixel7": {
        "label": "Pixel 7", "width": 412, "height": 915,
        "ua": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/105.0.0.0 Mobile Safari/537.36",
    },
}


def read_theme_vars():
    import webview

    keys_js = json.dumps(_THEME_VAR_NAMES)
    script = (
        f"(function(){{var s=getComputedStyle(document.documentElement);"
        f"var keys={keys_js};var out={{}};"
        f"keys.forEach(function(k){{out[k]=s.getPropertyValue('--color-'+k).trim();}});"
        f"return out;}})()"
    )
    try:
        result = webview.windows[0].evaluate_js(script)
        return result or {}
    except Exception:
        return {}


def is_start_page(url):
    return bool(url) and "/start.html" in url


def _browser_history_path():
    return APP_DATA_DIR / "browser_history.json"


def load_browser_history():
    try:
        return json.loads(_browser_history_path().read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_browser_history(data):
    try:
        _browser_history_path().write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass


def record_visit(url, title=None, favicon=None, increment=True):
    # Powers the "frequent sites" cards on the new-tab page — counts how
    # often a URL is opened (not every in-page navigation within it), so
    # this is only ever called when a tab is first pointed at a real URL,
    # plus once more (increment=False) to backfill the favicon once it
    # arrives, which is normally still unknown at that first moment.
    if not url or is_start_page(url):
        return
    data = load_browser_history()
    entry = data.get(url) or {"count": 0, "title": url, "favicon": None}
    if increment:
        entry["count"] = entry.get("count", 0) + 1
    if title:
        entry["title"] = title
    if favicon:
        entry["favicon"] = favicon
    data[url] = entry
    save_browser_history(data)


def top_frequent_sites(n=4):
    data = load_browser_history()
    items = sorted(data.items(), key=lambda kv: kv[1].get("count", 0), reverse=True)[:n]
    return [{"url": u, "title": v.get("title") or u, "favicon": v.get("favicon")} for u, v in items]


def start_page_url(own_ui_base):
    if not own_ui_base:
        return None
    query = urllib.parse.urlencode({
        "theme": json.dumps(read_theme_vars()),
        "favs": json.dumps(top_frequent_sites(4)),
    })
    return f"{own_ui_base}/start.html?{query}"


def normalize_url(url):
    url = (url or "").strip()
    if not url:
        return None
    if "://" in url or url.startswith("about:") or url.startswith("data:"):
        return url
    if url.startswith("localhost") or re.match(r"^\d+\.\d+\.\d+\.\d+", url):
        return f"http://{url}"
    return f"https://{url}"
