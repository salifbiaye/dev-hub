from . import store


class ProjectTasksMixin:
    """The "Tâches" tab: tasks, notes and the TODO scan, per project."""

    def tasks_load(self, path):
        return store.load(path)

    def tasks_save(self, path, data):
        return store.save(path, data)

    def tasks_scan_todos(self, path):
        return store.scan_todos(path)
