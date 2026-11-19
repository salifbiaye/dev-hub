import time

from . import scanner


class OutputsMixin:
    """The "Sorties" tab: files and folders the project's builds produced."""

    def outputs_list(self, path):
        from features.processes import run_configs

        return {"entries": scanner.list_outputs(path), "last_run": run_configs.last_run(path), "now": time.time()}

    def outputs_reveal(self, path, rel):
        return scanner.reveal(path, rel)

    def outputs_new(self, path, since=0):
        """How many outputs appeared after `since` (epoch seconds): the badge on the tab."""
        entries = scanner.list_outputs(path)
        return {"fresh": len([e for e in entries if e["mtime"] > float(since or 0)]), "total": len(entries), "now": time.time()}
