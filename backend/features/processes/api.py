from .orphan_detection import ProcessesOrphanMixin
from .run_configs import ProcessesRunMixin
from .stats import ProcessesStatsMixin


class ProcessesMixin(ProcessesRunMixin, ProcessesOrphanMixin, ProcessesStatsMixin):
    pass
