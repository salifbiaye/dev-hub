import ptyprocess


class _PtyAdapter:
    """Wraps ptyprocess.PtyProcessUnicode to match the surface base.py's
    spawn_pty() promises -- the same surface winpty.PtyProcess already has
    on Windows (.write, .read, .setwinsize, .close(force=True), .isalive(),
    .pid).

    The one real difference: ptyprocess raises ptyprocess.exceptions.EOF
    from .read() at end-of-stream, where winpty raises a plain EOFError.
    The shared cross-platform callers (features/terminal/sessions.py's
    stream_terminal() and features/processes/run_configs.py's
    _stream_run_terminal()) both do `except EOFError: break` -- rather than
    touch that shared code, this adapter re-raises ptyprocess's EOF as a
    plain EOFError so both callers keep working unmodified on either OS.
    """

    def __init__(self, proc):
        self._proc = proc

    def read(self, n):
        try:
            return self._proc.read(n)
        except ptyprocess.exceptions.EOF:
            raise EOFError()

    def write(self, data):
        return self._proc.write(data)

    def setwinsize(self, rows, cols):
        return self._proc.setwinsize(rows, cols)

    def close(self, force=True):
        return self._proc.close(force=force)

    def isalive(self):
        return self._proc.isalive()

    @property
    def pid(self):
        return self._proc.pid


def spawn_pty(argv, cwd, env, rows=24, cols=80):
    proc = ptyprocess.PtyProcessUnicode.spawn(argv, cwd=cwd, env=env, dimensions=(rows, cols))
    return _PtyAdapter(proc)
