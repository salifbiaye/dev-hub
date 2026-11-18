"""Project profile + test runs for the "Tests" tab.

`project_profile` looks at what is in the folder to decide which optional tabs make
sense (a front-only project has no use for an HTTP client). `start_test_run` runs the
project's test command in a PTY, streamed like every other terminal of Dev Hub, and
`test_run_report` reads the result: JUnit XML when the runner writes it (Maven,
Gradle, pytest), the output otherwise.
"""

import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

from core.platform import platform_svc
from features.terminal import sessions as terminal_sessions

_JS_DEFAULT_TEST = re.compile(r"no test specified", re.I)
_runs = {}  # terminal_id -> {"path", "command", "started", "kind", "junit_dir", "exit"}


def _read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        return {}


def _read_text(path):
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _js_manager(base):
    if (base / "pnpm-lock.yaml").exists():
        return "pnpm"
    if (base / "yarn.lock").exists():
        return "yarn"
    return "npm"


def detect_tests(base):
    """The test setup of a project, or None."""
    pkg = base / "package.json"
    if pkg.exists():
        data = _read_json(pkg)
        script = (data.get("scripts") or {}).get("test")
        if script and not _JS_DEFAULT_TEST.search(script):
            deps = {**(data.get("dependencies") or {}), **(data.get("devDependencies") or {})}
            runner = "vitest" if "vitest" in deps else "jest" if "jest" in deps else "javascript"
            manager = _js_manager(base)
            return {"kind": "js", "runner": runner, "label": {"vitest": "Vitest", "jest": "Jest"}.get(runner, "npm test"), "command": f"{manager} test"}
    win = os.name == "nt"
    if (base / "pom.xml").exists():
        wrapper = "mvnw.cmd" if win else "./mvnw"
        cmd = f"{wrapper} test" if (base / ("mvnw.cmd" if win else "mvnw")).exists() else "mvn test"
        return {"kind": "maven", "runner": "maven", "label": "Maven (JUnit)", "command": cmd}
    if any((base / n).exists() for n in ("build.gradle", "build.gradle.kts")):
        wrapper = "gradlew.bat" if win else "./gradlew"
        cmd = f"{wrapper} test" if (base / ("gradlew.bat" if win else "gradlew")).exists() else "gradle test"
        return {"kind": "gradle", "runner": "gradle", "label": "Gradle (JUnit)", "command": cmd}
    py_markers = ("pytest.ini", "tox.ini", "conftest.py", "pyproject.toml", "setup.cfg")
    if any((base / n).exists() for n in py_markers) and ((base / "tests").is_dir() or (base / "test").is_dir() or (base / "conftest.py").exists()):
        return {"kind": "pytest", "runner": "pytest", "label": "pytest", "command": "python -m pytest -q"}
    if (base / "go.mod").exists() and any(base.rglob("*_test.go")):
        return {"kind": "go", "runner": "go", "label": "Go", "command": "go test ./..."}
    if (base / "Cargo.toml").exists():
        return {"kind": "cargo", "runner": "cargo", "label": "Cargo", "command": "cargo test"}
    return None


_BACKEND_JS = ("express", "fastify", "koa", "@nestjs/core", "hapi", "@hapi/hapi", "restify", "next", "nuxt")
_BACKEND_PY = ("django", "flask", "fastapi", "starlette", "aiohttp", "tornado", "sanic")


def project_profile(path):
    """Which optional tabs fit this project."""
    base = Path(path)
    if not base.is_dir():
        return {"error": "Dossier introuvable"}
    backend = False
    kinds = []
    pkg = base / "package.json"
    if pkg.exists():
        data = _read_json(pkg)
        deps = {**(data.get("dependencies") or {}), **(data.get("devDependencies") or {})}
        kinds.append("node")
        if any(d in deps for d in _BACKEND_JS) and "next" not in deps and "nuxt" not in deps:
            backend = True
    for name in ("pom.xml", "build.gradle", "build.gradle.kts"):
        f = base / name
        if f.exists():
            kinds.append("jvm")
            text = _read_text(f).lower()
            if any(k in text for k in ("spring-boot", "spring-web", "quarkus", "micronaut", "ktor", "javalin", "vertx")):
                backend = True
    for name in ("requirements.txt", "pyproject.toml", "Pipfile", "setup.py"):
        f = base / name
        if f.exists():
            kinds.append("python")
            text = _read_text(f).lower()
            if any(k in text for k in _BACKEND_PY):
                backend = True
    if (base / "go.mod").exists():
        kinds.append("go")
        text = _read_text(base / "go.mod").lower()
        if any(k in text for k in ("gin-gonic", "labstack/echo", "gofiber", "go-chi", "gorilla/mux")):
            backend = True
    if (base / "composer.json").exists():
        kinds.append("php")
        if any(k in _read_text(base / "composer.json").lower() for k in ("laravel", "symfony")):
            backend = True
    docker = any(
        (base / n).exists()
        for n in ("Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")
    )
    tests = detect_tests(base)
    return {"kinds": sorted(set(kinds)), "backend": backend, "docker": docker, "tests": tests}


# ------------------------------------------------------------------ running

def _shell_argv(command):
    if os.name == "nt":
        return ["cmd.exe", "/d", "/s", "/c", command]
    return [os.environ.get("SHELL") or "/bin/sh", "-c", command]


def start_test_run(path, command, rows=24, cols=100):
    base = Path(path)
    command = (command or "").strip()
    if not base.is_dir():
        return {"error": "Dossier introuvable"}
    if not command:
        return {"error": "Aucune commande de test"}
    setup = detect_tests(base) or {}
    kind = setup.get("kind")
    junit_dir = None
    run_cmd = command
    # pytest can write a JUnit report anywhere: a temp folder, nothing added to the repo.
    if kind == "pytest" or re.search(r"\bpytest\b", command):
        junit_dir = tempfile.mkdtemp(prefix="devhub-junit-")
        run_cmd = f'{command} --junitxml="{Path(junit_dir) / "report.xml"}"'
    env = os.environ.copy()
    env.update({"TERM": "xterm-256color", "FORCE_COLOR": "1", "CI": "true"})  # CI: no watch mode (vitest/jest)
    try:
        proc = platform_svc.spawn_pty(_shell_argv(run_cmd), str(base), env, rows, cols)
    except Exception as e:
        return {"error": str(e)}
    terminal_id = str(uuid.uuid4())
    terminal_sessions.register(terminal_id, proc)
    run = {"path": str(base), "command": command, "started": time.time(), "kind": kind, "junit_dir": junit_dir, "exit": None}
    _runs[terminal_id] = run
    while len(_runs) > 20:  # keep the latest runs only; drop old ones and their temp reports
        old = _runs.pop(next(iter(_runs)))
        if old.get("junit_dir"):
            shutil.rmtree(old["junit_dir"], ignore_errors=True)

    def watch():
        # stream_terminal reads until the process ends and drops the terminal; the
        # exit code is read from the process afterwards.
        terminal_sessions.stream_terminal(terminal_id, proc)
        code = None
        for attr in ("exitstatus", "returncode"):
            code = getattr(proc, attr, None)
            if code is not None:
                break
        if code is None:
            try:
                proc.wait()
                code = getattr(proc, "exitstatus", None)
            except Exception:
                pass
        run["exit"] = code if code is not None else -1
        run["ended"] = time.time()

    threading.Thread(target=watch, daemon=True).start()
    return {"ok": True, "terminal_id": terminal_id, "command": command}


def stop_test_run(terminal_id):
    proc = terminal_sessions.get(terminal_id)
    if proc:
        try:
            platform_svc.kill_process_tree(proc.pid)
        except Exception:
            pass
        try:
            proc.close(force=True)
        except Exception:
            pass
    return {"ok": True}


def test_run_state(terminal_id):
    run = _runs.get(terminal_id)
    if not run:
        return {"error": "Run inconnu"}
    return {"finished": run["exit"] is not None, "exit": run["exit"], "started": run["started"], "ended": run.get("ended")}


# ------------------------------------------------------------------ results

_ANSI = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07")


def _clean(text):
    return _ANSI.sub("", text or "")


def _junit_files(run):
    base = Path(run["path"])
    started = run["started"] - 2
    roots = []
    if run.get("junit_dir"):
        roots.append(Path(run["junit_dir"]))
    roots += [base / "target" / "surefire-reports", base / "target" / "failsafe-reports", base / "build" / "test-results"]
    found = []
    for r in roots:
        if r.is_dir():
            for f in r.rglob("*.xml"):
                try:
                    if f.stat().st_mtime >= started:
                        found.append(f)
                except OSError:
                    pass
    return found


def _locate(base, classname, trace):
    """File and line of a failing test from its class name and stack trace."""
    simple = (classname or "").split(".")[-1].split("$")[0]
    for m in re.finditer(r"\(([\w$]+\.(?:java|kt|scala|groovy)):(\d+)\)", trace or ""):
        name, line = m.group(1), int(m.group(2))
        if simple and name.split(".")[0] == simple:
            hit = next(iter(base.rglob(name)), None)
            if hit:
                return hit.relative_to(base).as_posix(), line
    for m in re.finditer(r'File "([^"]+)", line (\d+)', trace or ""):
        p = Path(m.group(1))
        try:
            rel = p.resolve().relative_to(base.resolve()).as_posix()
        except (ValueError, OSError):
            continue
        return rel, int(m.group(2))
    m = re.search(r"([\w./\\-]+\.py):(\d+)", trace or "")
    if m:
        cand = base / m.group(1).replace("\\", "/")
        if cand.exists():
            return cand.relative_to(base).as_posix(), int(m.group(2))
    if simple:
        for ext in ("java", "kt"):
            hit = next(iter(base.rglob(f"{simple}.{ext}")), None)
            if hit:
                return hit.relative_to(base).as_posix(), None
    return None, None


def _parse_junit(files, base):
    passed = failed = skipped = 0
    failures = []
    for f in files:
        try:
            root = ET.parse(f).getroot()
        except (ET.ParseError, OSError):
            continue
        for case in root.iter("testcase"):
            bad = case.find("failure")
            if bad is None:
                bad = case.find("error")
            if case.find("skipped") is not None:
                skipped += 1
            elif bad is not None:
                failed += 1
                trace = (bad.text or "").strip()
                file, line = _locate(base, case.get("classname"), trace)
                failures.append(
                    {
                        "name": f"{(case.get('classname') or '').split('.')[-1]}.{case.get('name')}".strip("."),
                        "file": file,
                        "line": line,
                        "message": _clean((bad.get("message") or trace.split("\n")[0])[:400]),
                        "trace": _clean(trace[:3000]),
                    }
                )
            else:
                passed += 1
    return passed, failed, skipped, failures


def _parse_output(text):
    """Summary and failures from a runner's console output (JS, Go, Cargo, pytest)."""
    text = _clean(text)
    passed = failed = skipped = 0
    m = re.search(r"Tests:\s+(?:(\d+) failed,\s*)?(?:(\d+) skipped,\s*)?(?:(\d+) passed,\s*)?(\d+) total", text)  # jest
    if m:
        failed, skipped, passed = int(m.group(1) or 0), int(m.group(2) or 0), int(m.group(3) or 0)
    else:
        m = re.search(r"Tests\s+(?:(\d+) failed\s*\|?\s*)?(?:(\d+) skipped\s*\|?\s*)?(?:(\d+) passed)?", text)  # vitest
        if m and (m.group(1) or m.group(3)):
            failed, skipped, passed = int(m.group(1) or 0), int(m.group(2) or 0), int(m.group(3) or 0)
        else:
            m = re.search(r"(?:(\d+) failed)?[, ]*(?:(\d+) passed)?[, ]*(?:(\d+) skipped)?.* in [\d.]+s", text)  # pytest
            if m and (m.group(1) or m.group(2)):
                failed, passed, skipped = int(m.group(1) or 0), int(m.group(2) or 0), int(m.group(3) or 0)
            else:
                passed = len(re.findall(r"^\s*--- PASS", text, re.M))  # go
                failed = len(re.findall(r"^\s*--- FAIL", text, re.M))
                m = re.search(r"test result: \w+\. (\d+) passed; (\d+) failed", text)  # cargo
                if m:
                    passed, failed = int(m.group(1)), int(m.group(2))
    failures, seen = [], set()
    for m in re.finditer(r"^\s*(?:FAIL|✕|×|--- FAIL:|FAILED)\s+(.+)$", text, re.M):
        name = m.group(1).strip()[:160]
        if name in seen:
            continue
        seen.add(name)
        fm = re.match(r"([^\s>:]+\.[\w]+)", name)
        failures.append({"name": name, "file": fm.group(1) if fm else None, "line": None, "message": "", "trace": ""})
    return passed, failed, skipped, failures[:60]


def test_run_report(terminal_id, output_tail=""):
    run = _runs.get(terminal_id)
    if not run:
        return {"error": "Run inconnu"}
    base = Path(run["path"])
    files = _junit_files(run)
    source = "junit"
    if files:
        passed, failed, skipped, failures = _parse_junit(files, base)
    else:
        source = "output"
        passed, failed, skipped, failures = _parse_output(output_tail or (terminal_sessions.get_buffer(terminal_id) or terminal_sessions.finished_buffer(terminal_id) or ""))
    exit_code = run["exit"]
    ok = (exit_code == 0) if exit_code is not None else None
    if ok is False and failed == 0 and not failures:
        # It failed without a readable report (compilation error, missing dependency…).
        tail = _clean(output_tail or (terminal_sessions.get_buffer(terminal_id) or terminal_sessions.finished_buffer(terminal_id) or ""))
        tail_lines = [l for l in tail.splitlines() if l.strip()][-25:]
        failures = [{"name": "Les tests n'ont pas pu s'exécuter", "file": None, "line": None, "message": "\n".join(tail_lines)[-1200:], "trace": ""}]
    if run.get("junit_dir"):
        shutil.rmtree(run["junit_dir"], ignore_errors=True)
    return {
        "ok": ok,
        "exit": exit_code,
        "passed": passed,
        "failed": failed,
        "skipped": skipped,
        "total": passed + failed + skipped,
        "failures": failures,
        "source": source,
        "duration": round((run.get("ended") or time.time()) - run["started"], 1),
    }
