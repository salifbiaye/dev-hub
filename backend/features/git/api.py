from .branches import GitBranchesMixin
from .commit import GitCommitMixin
from .conflicts import GitConflictsMixin
from .stash import GitStashMixin
from .status import GitStatusMixin


class GitMixin(GitStatusMixin, GitCommitMixin, GitBranchesMixin, GitStashMixin, GitConflictsMixin):
    pass
