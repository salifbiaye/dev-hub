"""Custom project / group icons: small images kept as data URLs in the config."""

MAX_LEN = 400_000  # the UI shrinks images to 320 px WebP (tens of KB); this only guards the config file
_PREFIXES = ("data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,", "data:image/svg+xml;base64,", "data:image/gif;base64,")


def clean_icon(icon):
    """-> (data_url or None, error or None). None / empty means "remove the icon"."""
    if not icon:
        return None, None
    if not isinstance(icon, str) or not icon.startswith(_PREFIXES):
        return None, "Image non reconnue (PNG, JPEG, WebP, GIF ou SVG)"
    if len(icon) > MAX_LEN:
        return None, "Image trop lourde"
    return icon, None
