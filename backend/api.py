"""The single js_api surface pywebview sees -- zero logic of its own, just
composes every feature's Mixin into one flat class, exactly as before."""
from features.browser.api import BrowserMixin
from features.database.api import DatabaseMixin
from features.git.api import GitMixin
from features.ide.api import IdeMixin
from features.processes.api import ProcessesMixin
from features.repo_host.api import RepoHostMixin
from features.repos.api import ReposMixin
from features.terminal.api import TerminalMixin
from features.window_chrome.api import WindowChromeMixin


class Api(
    GitMixin,
    DatabaseMixin,
    TerminalMixin,
    ProcessesMixin,
    IdeMixin,
    RepoHostMixin,
    ReposMixin,
    WindowChromeMixin,
    BrowserMixin,
):
    pass
