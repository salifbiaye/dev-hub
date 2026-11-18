"""The single js_api surface pywebview sees -- zero logic of its own, just
composes every feature's Mixin into one flat class, exactly as before."""
from features.ai_accounts.api import AiAccountsMixin
from features.browser.api import BrowserMixin
from features.database.api import DatabaseMixin
from features.git.api import GitMixin
from features.http_client.api import HttpClientMixin
from features.hubi.api import HubiMixin
from features.ide.api import IdeMixin
from features.processes.api import ProcessesMixin
from features.project_tasks.api import ProjectTasksMixin
from features.repo_host.api import RepoHostMixin
from features.repos.api import ReposMixin
from features.terminal.api import ComposerMixin, TerminalMixin, TranscriptMixin
from features.tests.api import TestsMixin
from features.ui_state.api import UiStateMixin
from features.window_chrome.api import WindowChromeMixin


class Api(
    GitMixin,
    DatabaseMixin,
    TerminalMixin,
    ComposerMixin,
    TranscriptMixin,
    ProcessesMixin,
    IdeMixin,
    RepoHostMixin,
    ReposMixin,
    WindowChromeMixin,
    BrowserMixin,
    HubiMixin,
    AiAccountsMixin,
    TestsMixin,
    HttpClientMixin,
    ProjectTasksMixin,
    UiStateMixin,
):
    pass
