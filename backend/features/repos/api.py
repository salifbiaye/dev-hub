from .files import ReposFilesMixin
from .groups import ReposGroupsMixin
from .projects import ReposProjectsMixin
from .settings import ReposSettingsMixin


class ReposMixin(ReposProjectsMixin, ReposGroupsMixin, ReposFilesMixin, ReposSettingsMixin):
    pass
