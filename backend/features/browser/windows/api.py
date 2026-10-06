from .navigation import _NavigationMixin
from .tabs import _TabsMixin


class BrowserWindowApi(_TabsMixin, _NavigationMixin):
    pass
