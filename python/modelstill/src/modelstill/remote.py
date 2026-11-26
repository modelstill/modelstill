import shlex
import subprocess
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

__all__ = ["RemoteHost", "Run", "Workspace"]

Run = Callable[..., subprocess.CompletedProcess[str]]
_SSH_FAILED = 255
_EXCLUDES = (".venv", "__pycache__", "dist", ".pytest_cache", ".ruff_cache")


def _package_dir() -> Path:
    return Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Workspace:
    root: str
    package: str
    uv: str
    commit: str


class RemoteHost:
    def __init__(
        self,
        host: str,
        workdir: str = "modelstill",
        poll_seconds: float = 60,
        run: Run = subprocess.run,
        sleep: Callable[[float], None] = time.sleep,
        package_dir: Path | None = None,
    ) -> None:
        self.host = host
        self.workdir = workdir
        self.poll_seconds = poll_seconds
        self._run = run
        self._sleep = sleep
        self.package_dir = package_dir or _package_dir()

    def ssh(self, script: str, stdin: str | None = None) -> subprocess.CompletedProcess[str]:
        return self._run(
            ["ssh", "-o", "BatchMode=yes", self.host, script],
            input=stdin,
            capture_output=True,
            text=True,
            check=False,
        )

    def checked(self, script: str, stdin: str | None = None) -> str:
        done = self.ssh(script, stdin)
        if done.returncode != 0:
            raise RuntimeError(f"{self.host}: {script!r} failed: {done.stderr.strip()[:500]}")
        return done.stdout

    def rsync(self, source: str, destination: str, *options: str) -> None:
        command = ["rsync", "-az", *options, source, destination]
        done = self._run(command, capture_output=True, text=True, check=False)
        if done.returncode != 0:
            raise RuntimeError(f"rsync {source} -> {destination} failed: {done.stderr[:500]}")

    def prepare(self) -> Workspace:
        home = self.checked("echo $HOME").strip()
        root = f"{home}/{self.workdir}"
        package = f"{root}/python/modelstill"
        self.checked(f"mkdir -p {shlex.quote(package)} {shlex.quote(root)}/runs")
        excludes = [part for name in _EXCLUDES for part in ("--exclude", name)]
        self.rsync(f"{self.package_dir}/", f"{self.host}:{package}/", "--delete", *excludes)
        return Workspace(root=root, package=package, uv="", commit="")

    def install(self, workspace: Workspace) -> Workspace:
        uv = self.ssh("command -v uv").stdout.strip() or "uv"
        commit = self._git_commit()
        self.checked(f"cd {shlex.quote(workspace.package)} && {uv} sync --frozen --extra train -q")
        return Workspace(workspace.root, workspace.package, uv, commit)

    def send(self, local: Path, remote: str) -> None:
        parent = remote.rsplit("/", 1)[0]
        self.checked(f"mkdir -p {shlex.quote(parent)}")
        self.rsync(str(local), f"{self.host}:{remote}", "--ignore-existing")

    def send_dir(self, local: Path, remote: str) -> None:
        self.checked(f"mkdir -p {shlex.quote(remote)}")
        self.rsync(f"{local}/", f"{self.host}:{remote}/")

    def write(self, remote: str, text: str) -> None:
        parent = remote.rsplit("/", 1)[0]
        self.checked(f"mkdir -p {shlex.quote(parent)} && cat > {shlex.quote(remote)}", text)

    def fetch_dir(self, remote: str, local: Path) -> None:
        if local.exists():
            raise FileExistsError(f"{local} already exists; artifact paths are never overwritten")
        local.parent.mkdir(parents=True, exist_ok=True)
        self.rsync(f"{self.host}:{remote}/", str(local))

    def run_job(
        self,
        workspace: Workspace,
        unit: str,
        prefix: str,
        module: str,
        args: Sequence[str],
        gpus: Sequence[str],
        stop_services: Sequence[str] = (),
        env: Mapping[str, str] | None = None,
        env_files: Mapping[str, str] | None = None,
    ) -> str:
        script = self._job_script(workspace, prefix, module, args, gpus, stop_services)
        exports = [f"export {name}={shlex.quote(value)}" for name, value in (env or {}).items()]
        exports += [
            f'export {name}="$(cat {shlex.quote(path)})"'
            for name, path in (env_files or {}).items()
        ]
        if exports:
            lines = script.split("\n")
            script = "\n".join([*lines[:-1], *exports, lines[-1]])
        self.checked(f"systemd-run --user --unit={unit} --collect bash -c " + shlex.quote(script))
        self._wait(unit, prefix)
        found = self.ssh(f"cat {shlex.quote(prefix)}.result.json")
        if found.returncode != 0:
            tail = self.ssh(f"tail -n 40 {shlex.quote(prefix)}.log").stdout
            raise RuntimeError(f"the job on {self.host} left no result; end of its log:\n{tail}")
        return found.stdout

    def _git_commit(self) -> str:
        done = self._run(
            ["git", "-C", str(self.package_dir), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=False,
        )
        return done.stdout.strip() if done.returncode == 0 else ""

    @staticmethod
    def _job_script(
        workspace: Workspace,
        prefix: str,
        module: str,
        args: Sequence[str],
        gpus: Sequence[str],
        stop_services: Sequence[str],
    ) -> str:
        launcher = (
            f"accelerate launch --num_processes {len(gpus)} -m {module}"
            if len(gpus) > 1
            else f"python -m {module}"
        )
        quoted = " ".join(shlex.quote(arg) for arg in args)
        lines = [f'trap "systemctl --user start {service}" EXIT' for service in stop_services]
        lines += [f"systemctl --user stop {service}" for service in stop_services]
        lines += [
            f"cd {shlex.quote(workspace.package)}",
            f"export CUDA_VISIBLE_DEVICES={','.join(gpus)}",
            f"export MODELSTILL_GIT_COMMIT={shlex.quote(workspace.commit)}",
            f"{workspace.uv} run --frozen --extra train {launcher} {quoted} "
            f"{shlex.quote(prefix)}.result.json > {shlex.quote(prefix)}.log 2>&1",
        ]
        return "\n".join(lines)

    def _wait(self, unit: str, prefix: str) -> None:
        last = ""
        while True:
            self._sleep(self.poll_seconds)
            state = self.ssh(f"systemctl --user is-active {unit}")
            if state.returncode == _SSH_FAILED:
                print(
                    f"{self.host} unreachable, still waiting: {state.stderr.strip()}",
                    file=sys.stderr,
                )
                continue
            progress = self.ssh(
                f"grep -E 'eval_loss|Error|Traceback' {shlex.quote(prefix)}.log | tail -n 1"
            ).stdout.strip()
            if progress and progress != last:
                print(progress, file=sys.stderr)
                last = progress
            if state.stdout.strip() not in {"active", "activating"}:
                return
