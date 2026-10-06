"""OS abstraction layer.

Picks the Windows or Linux platform implementation once, at import time,
based on ``sys.platform``, and exposes it as the module-level ``platform_svc``
singleton that every feature imports instead of touching OS-specific APIs
directly.
"""
import sys

if sys.platform.startswith("win"):
    from .windows import WindowsPlatform as _PlatformImpl
else:
    from .linux import LinuxPlatform as _PlatformImpl

platform_svc = _PlatformImpl()

__all__ = ["platform_svc"]
