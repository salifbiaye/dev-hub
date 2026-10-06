import winpty


def spawn_pty(argv, cwd, env, rows=24, cols=80):
    # winpty.PtyProcess already exposes exactly the surface base.py's
    # spawn_pty() promises (.write, .read, .setwinsize, .close(force=True),
    # .isalive(), .pid) -- no wrapper needed, just construct it the same way
    # the old monolithic main.py did.
    return winpty.PtyProcess.spawn(argv, cwd=cwd, env=env, dimensions=(rows, cols))
