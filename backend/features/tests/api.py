from . import runner


class TestsMixin:
    """The Tests tab and the adaptive project tabs (see runner.py)."""

    __test__ = False  # not a pytest class

    def project_profile(self, path):
        return runner.project_profile(path)

    def start_test_run(self, path, command, rows=24, cols=100):
        return runner.start_test_run(path, command, rows, cols)

    def stop_test_run(self, terminal_id):
        return runner.stop_test_run(terminal_id)

    def test_run_state(self, terminal_id):
        return runner.test_run_state(terminal_id)

    def test_run_report(self, terminal_id, output_tail=""):
        return runner.test_run_report(terminal_id, output_tail)
