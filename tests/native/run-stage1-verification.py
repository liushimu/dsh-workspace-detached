#!/usr/bin/env python3
"""Record this bounded repair's offline/no-window build, hashes and read-only SDK evidence."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BIN = ROOT / "tests/native/bin"
BASELINE = BIN / "stage1-baseline.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def vendor_snapshot() -> dict:
    vendor = ROOT / "vendor/webview2"
    return {str(path.relative_to(ROOT)).replace("\\", "/"): {
        "kind": "file" if path.is_file() else "directory",
        "mtimeNs": path.stat().st_mtime_ns,
        **({"sha256": digest(path), "bytes": path.stat().st_size} if path.is_file() else {}),
    } for path in [vendor, *sorted(vendor.rglob("*"))]}


def owned_files() -> dict:
    paths = [ROOT / "scripts/build-native.py"]
    paths += [path for path in (ROOT / "native").rglob("*") if path.is_file()]
    paths += [path for path in (ROOT / "tests/native").rglob("*")
              if path.is_file() and BIN not in path.parents and "__pycache__" not in path.parts]
    return {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in sorted(paths)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture-baseline", action="store_true")
    parser.add_argument("--label", choices=("sc1", "stage1", "round4"), default="stage1")
    args = parser.parse_args()
    BIN.mkdir(exist_ok=True)
    baseline_path = BIN / "round4-baseline.json" if args.label == "round4" else BASELINE
    def scoped_files() -> dict:
        files = owned_files()
        if args.label == "round4":
            files.pop("native/README.md", None)  # Parent owns documentation in the shared filesystem.
        return files
    if args.capture_baseline:
        with baseline_path.open("x", encoding="utf-8") as target:
            json.dump({"ownedFiles": scoped_files(), "vendor": vendor_snapshot()}, target, indent=2)
            target.write("\n")
        print("Captured " + str(baseline_path))
        return 0
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    if vendor_snapshot() != baseline["vendor"]:
        raise RuntimeError("SDK cache changed since baseline; no build executed")
    command = [sys.executable, str(ROOT / "scripts/build-native.py"), "--test"]
    print("RUN " + subprocess.list2cmdline(command), flush=True)
    test_results = {}
    with (BIN / (args.label + "-build.log")).open("w", encoding="utf-8") as log:
        log.write("RUN " + subprocess.list2cmdline(command) + "\n")
        log.flush()
        with subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, encoding="utf-8", errors="strict") as process:
            for line in process.stdout:
                print(line, end="", flush=True)
                log.write(line)
                if line.startswith("{"):
                    event = json.loads(line)
                    if event.get("op") in ("native-tests", "bridge-tests", "artifact-tests"):
                        test_results[event["op"]] = event
            outcome = process.wait()
    current = scoped_files()
    cache_unchanged = vendor_snapshot() == baseline["vendor"]
    receipt = {
        "command": command, "exitCode": outcome, "guiLaunched": False,
        "baselinePath": str(baseline_path),
        "testResults": test_results,
        "totalAssertions": sum(event["passed"] for event in test_results.values()),
        "sdkCacheUnchangedBytesAndMtimes": cache_unchanged,
        "changedFiles": [path for path in sorted(set(current) | set(baseline["ownedFiles"]))
                         if current.get(path) != baseline["ownedFiles"].get(path)],
        "currentHashes": current,
        "remainingAcceptance": "Real WebView, Locate focus, physical monitor unplug/DPI, minimize/maximize and full Host integration are not executed.",
    }
    (BIN / (args.label + "-repair-receipt.json")).write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    if not cache_unchanged:
        raise RuntimeError("SDK cache bytes or mtimes changed")
    print(json.dumps({"op": "stage1-repair-verification", "exitCode": outcome,
                      "sdkCacheUnchangedBytesAndMtimes": cache_unchanged, "guiLaunched": False}))
    return outcome


if __name__ == "__main__":
    raise SystemExit(main())
