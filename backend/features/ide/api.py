from .detection import IdeDetectionMixin
from .focus_restart import IdeFocusRestartMixin
from .launch import IdeLaunchMixin


class IdeMixin(IdeDetectionMixin, IdeLaunchMixin, IdeFocusRestartMixin):
    pass
