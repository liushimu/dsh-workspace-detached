#!/usr/bin/env python3
"""Build only the independent Windows x64 display carrier; never install or launch a GUI.

Use --fetch-sdk once to download the pinned official NuGet SDK into vendor/.
Python's standard urllib proxy configuration is retained; network denials are fatal.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "native"
VENDOR = ROOT / "vendor" / "webview2"
SDK_VERSION = "1.0.4314.35"
SDK_NAME = f"microsoft.web.webview2.{SDK_VERSION}.nupkg"
SDK_URL = (
    "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/"
    f"{SDK_VERSION}/{SDK_NAME}"
)
PACKAGE_PAGE = f"https://www.nuget.org/packages/Microsoft.Web.WebView2/{SDK_VERSION}"
LICENSE_PAGE = PACKAGE_PAGE + "/License"
CSC = Path("C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe")
DLLS = {
    "Microsoft.Web.WebView2.Core.dll": "lib/net462/Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.WinForms.dll": "lib/net462/Microsoft.Web.WebView2.WinForms.dll",
    "WebView2Loader.dll": "runtimes/win-x64/native/WebView2Loader.dll",
}
MAX_DOWNLOAD = 64 * 1024 * 1024


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def fetch_sdk() -> Path:
    archive = VENDOR / SDK_NAME
    receipt = VENDOR / "source.json"
    if archive.exists():
        if not receipt.exists():
            raise RuntimeError("SDK archive has no provenance receipt; refusing unverified cache")
        metadata = json.loads(receipt.read_text(encoding="utf-8"))
        if metadata.get("version") != SDK_VERSION or metadata.get("source") != SDK_URL:
            raise RuntimeError("SDK cache provenance does not match the pinned official source")
        if metadata.get("sha256") != sha256(archive):
            raise RuntimeError("SDK cache SHA256 mismatch")
        return archive
    if not ARGS.fetch_sdk:
        raise RuntimeError("SDK cache absent; re-run with --fetch-sdk to use the official NuGet endpoint")
    VENDOR.mkdir(parents=True, exist_ok=True)
    temporary = VENDOR / (SDK_NAME + ".partial")
    if temporary.exists() and temporary.stat().st_size != 0:
        raise RuntimeError("Nonempty partial SDK download exists; inspect it before a retry")
    request = urllib.request.Request(SDK_URL, headers={"User-Agent": "WorkspaceNavigator-NativeBuild/1"})
    total = 0
    try:
        with urllib.request.urlopen(request, timeout=60) as response, temporary.open("wb") as target:
            final_url = response.geturl()
            # The configured route redirects this official API request to the NuGet China mirror.
            # Accept only that observed HTTPS endpoint, not arbitrary redirects or alternate proxies.
            if final_url not in (SDK_URL, SDK_URL.replace("api.nuget.org", "nuget.azure.cn")):
                raise RuntimeError("Unexpected redirect from the pinned NuGet API request")
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                if total > MAX_DOWNLOAD:
                    raise RuntimeError("SDK download exceeds the fixed 64 MiB budget")
                target.write(block)
        if not zipfile.is_zipfile(temporary):
            raise RuntimeError("Official endpoint did not return a NuGet ZIP")
        digest = sha256(temporary)
        temporary.rename(archive)
        receipt.write_text(json.dumps({
            "package": "Microsoft.Web.WebView2", "version": SDK_VERSION,
            "source": SDK_URL, "finalUrl": final_url, "packagePage": PACKAGE_PAGE,
            "licensePage": LICENSE_PAGE, "sha256": digest, "bytes": total,
            "note": "SHA256 records downloaded bytes, not an independent publisher signature validation.",
        }, indent=2) + "\n", encoding="utf-8")
        return archive
    except Exception:
        # Preserve any partial bytes for inspection; do not bypass policy or silently retry elsewhere.
        raise


def extract_sdk(archive: Path) -> Path:
    sdk = VENDOR / SDK_VERSION
    with zipfile.ZipFile(archive) as package:
        names = package.namelist()
        required = list(DLLS.values())
        # Keep the publisher's actual license and XML API references alongside the development cache.
        licenses = [name for name in names if name.lower().rsplit("/", 1)[-1] in
                    ("license.txt", "license", "license.md")]
        if not licenses:
            raise RuntimeError("Official SDK archive has no license notice")
        xml_docs = [name for name in names if name.startswith("lib/net462/") and name.endswith(".xml")]
        members = required + licenses + xml_docs
        if sdk.is_dir():
            # An offline build only verifies/reads the pinned cache; do not rewrite DLLs, XML,
            # license notices or directory timestamps merely to regenerate native output.
            for name in members:
                cached = sdk / name
                expected = hashlib.sha256(package.read(name)).hexdigest()
                if not cached.is_file() or sha256(cached) != expected:
                    raise RuntimeError("Extracted SDK cache is incomplete or differs from the pinned archive: " + name)
            if sha256(sdk / "WebView2-LICENSE.txt") != sha256(sdk / licenses[0]):
                raise RuntimeError("Extracted SDK redistribution license mismatch")
            return sdk
        if not ARGS.fetch_sdk:
            raise RuntimeError("Extracted SDK cache absent; --fetch-sdk is required for initial extraction")
        sdk.mkdir(parents=True, exist_ok=True)
        for name in members:
            item = package.getinfo(name)
            if item.file_size > MAX_DOWNLOAD:
                raise RuntimeError("SDK member exceeds extraction budget")
            relative = Path(name)
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError("Unsafe SDK member path")
            destination = sdk / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            with package.open(item) as source, destination.open("wb") as target:
                shutil.copyfileobj(source, target)
        license_source = sdk / licenses[0]
        shutil.copyfile(license_source, sdk / "WebView2-LICENSE.txt")
    return sdk


def run(command: list[str]) -> None:
    print("RUN " + subprocess.list2cmdline(command), flush=True)
    subprocess.run(command, check=True, cwd=ROOT)


def build(sdk: Path) -> Path:
    if platform.system() != "Windows" or not CSC.is_file():
        raise RuntimeError("The Windows Framework64 csc compiler is required")
    output = NATIVE / "win-x64"
    output.mkdir(parents=True, exist_ok=True)
    executable = output / "WorkspaceNavigator.exe"
    sources = [NATIVE / name for name in ("Program.cs", "WireProtocol.cs", "WindowGeometry.cs", "NavigatorForm.cs")]
    references = ["System.dll", "System.Core.dll", "System.Drawing.dll", "System.Windows.Forms.dll"]
    references += [str(sdk / DLLS[name]) for name in
                   ("Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll")]
    command = [str(CSC), "/nologo", "/langversion:5", "/target:winexe", "/platform:x64",
               "/optimize+", "/warn:4", "/warnaserror+", "/utf8output",
               "/out:" + str(executable), "/win32manifest:" + str(NATIVE / "app.manifest"),
               "/resource:" + str(NATIVE / "bridge.js") + ",WorkspaceNavigator.Bridge.js"]
    command += ["/reference:" + value for value in references]
    command += [str(source) for source in sources]
    run(command)
    for filename, member in DLLS.items():
        shutil.copyfile(sdk / member, output / filename)
    shutil.copyfile(NATIVE / "app.config", output / "WorkspaceNavigator.exe.config")
    shutil.copyfile(sdk / "WebView2-LICENSE.txt", output / "WebView2-LICENSE.txt")
    notice = {
        "architecture": "win-x64", "sdkVersion": SDK_VERSION,
        "source": SDK_URL, "sdkSha256": sha256(VENDOR / SDK_NAME),
        "files": {path.name: sha256(path) for path in sorted(output.iterdir()) if path.is_file()
                  and path.name != "build-manifest.json"},
    }
    (output / "build-manifest.json").write_text(json.dumps(notice, indent=2) + "\n", encoding="utf-8")
    return executable


def verify(executable: Path, sdk: Path) -> None:
    tests = ROOT / "tests" / "native"
    binary_dir = tests / "bin"
    binary_dir.mkdir(parents=True, exist_ok=True)
    test_exe = binary_dir / "NativeTests.exe"
    run([str(CSC), "/nologo", "/langversion:5", "/target:exe", "/platform:x64", "/warn:4",
         "/warnaserror+", "/out:" + str(test_exe), "/main:WorkspaceNavigator.NativeTests", "/reference:System.dll",
         "/reference:System.Core.dll", "/reference:System.Drawing.dll", "/reference:System.Windows.Forms.dll",
         *["/reference:" + str(sdk / DLLS[name]) for name in
           ("Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll")],
         *[str(NATIVE / name) for name in ("Program.cs", "WireProtocol.cs", "WindowGeometry.cs", "NavigatorForm.cs")],
         str(tests / "NativeTests.cs")])
    run([str(test_exe)])
    run([sys.executable, str(tests / "verify-native.py"), "--executable", str(executable)])
    # Both modes return before Application.Run/CreateAsync and never create a window/profile.
    run([str(executable), "--version"])
    run([str(executable), "--probe"])


def main() -> int:
    sdk = extract_sdk(fetch_sdk())
    if ARGS.sdk_only:
        print("SDK " + str(sdk), flush=True)
        return 0
    executable = build(sdk)
    if ARGS.test:
        verify(executable, sdk)
    print("BUILT " + str(executable), flush=True)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch-sdk", action="store_true", help="Fetch pinned official NuGet SDK if absent")
    parser.add_argument("--test", action="store_true", help="Run only headless transport/static/probe checks")
    parser.add_argument("--sdk-only", action="store_true", help="Download/verify/extract the development SDK without compiling")
    ARGS = parser.parse_args()
    try:
        raise SystemExit(main())
    except Exception as error:
        print("Native build failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
