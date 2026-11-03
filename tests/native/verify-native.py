#!/usr/bin/env python3
"""Headless artifact/CLI/security checks. Never invoke normal window mode."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import xml.etree.ElementTree as ET
import uuid

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / "native"
PASSED = 0


def check(value: bool, label: str) -> None:
    global PASSED
    if not value:
        raise AssertionError(label)
    PASSED += 1


def pe_manifest(executable: Path) -> bytes:
    data = executable.read_bytes()
    check(data[:2] == b"MZ", "DOS image header")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    check(data[pe:pe + 4] == b"PE\0\0", "PE signature")
    check(struct.unpack_from("<H", data, pe + 4)[0] == 0x8664, "x64 machine type")
    section_count = struct.unpack_from("<H", data, pe + 6)[0]
    optional_size = struct.unpack_from("<H", data, pe + 20)[0]
    optional = pe + 24
    check(struct.unpack_from("<H", data, optional)[0] == 0x20B, "PE32+ optional header")
    check(struct.unpack_from("<H", data, optional + 68)[0] == 2, "Windows GUI subsystem (no console window)")
    resource_rva = struct.unpack_from("<I", data, optional + 112 + 16)[0]
    sections = []
    for index in range(section_count):
        section = optional + optional_size + 40 * index
        size, address, raw_size, pointer = struct.unpack_from("<IIII", data, section + 8)
        sections.append((address, max(size, raw_size), pointer))

    def rva_offset(rva: int) -> int:
        for address, size, pointer in sections:
            if address <= rva < address + size:
                return pointer + rva - address
        raise AssertionError("Unmapped resource RVA")

    resource_base = rva_offset(resource_rva)

    def entries(offset: int) -> list[tuple[int, int]]:
        named, numbered = struct.unpack_from("<HH", data, resource_base + offset + 12)
        return [struct.unpack_from("<II", data, resource_base + offset + 16 + index * 8)
                for index in range(named + numbered)]

    manifest_type = next(offset for key, offset in entries(0) if key == 24)
    manifest_id = next(offset for key, offset in entries(manifest_type & 0x7FFFFFFF) if key == 1)
    language = entries(manifest_id & 0x7FFFFFFF)[0][1]
    rva, length = struct.unpack_from("<II", data, resource_base + language)
    offset = rva_offset(rva)
    return data[offset:offset + length]


def run_cli(executable: Path, args: list[str], cwd: Path, expected_code: int = 0,
            overrides: dict[str, str] | None = None) -> dict:
    environment = os.environ.copy()
    environment.update(overrides or {})
    result = subprocess.run([str(executable), *args], cwd=cwd, capture_output=True,
                            timeout=30, creationflags=subprocess.CREATE_NO_WINDOW, env=environment)
    check(result.returncode == expected_code, "CLI return code " + repr(args))
    check(not result.stdout.startswith(b"\xef\xbb\xbf"), "no stdout BOM")
    check(result.stdout.count(b"\n") == 1, "one JSON stdout line " + repr(args))
    value = json.loads(result.stdout.decode("utf-8"))
    check(isinstance(value, dict), "structured CLI response")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", required=True, type=Path)
    parser.add_argument("--node", type=Path)
    args = parser.parse_args()
    executable = args.executable.resolve()
    output = executable.parent
    manifest = ET.fromstring(pe_manifest(executable))
    content = ET.tostring(manifest, encoding="unicode")
    check("PerMonitorV2,PerMonitor" in content, "embedded per-monitor DPI manifest")
    check('level="asInvoker"' in content, "embedded non-elevated execution manifest")
    check('processorArchitecture="amd64"' in content, "embedded x64 identity")
    bridge = (NATIVE / "bridge.js").read_bytes()
    check(bridge in executable.read_bytes(), "actual built executable embeds the current bridge bytes")
    config = ET.parse(output / "WorkspaceNavigator.exe.config")
    check(config.getroot().find("./startup/supportedRuntime").attrib["sku"] == ".NETFramework,Version=v4.6.2",
          "relative Framework runtime config")
    required = {"WorkspaceNavigator.exe", "WorkspaceNavigator.exe.config", "Microsoft.Web.WebView2.Core.dll",
                "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", "WebView2-LICENSE.txt"}
    receipt = json.loads((output / "build-manifest.json").read_text(encoding="utf-8"))
    check(required <= receipt["files"].keys(), "complete relative deployment manifest")
    for name, digest in receipt["files"].items():
        check(hashlib.sha256((output / name).read_bytes()).hexdigest() == digest, "deployed hash " + name)
    check("Redistribution and use in source and binary forms" in
          (output / "WebView2-LICENSE.txt").read_text(encoding="utf-8"), "SDK redistribution notice included")
    source = json.loads((ROOT / "vendor/webview2/source.json").read_text(encoding="utf-8"))
    archive = ROOT / "vendor/webview2" / f"microsoft.web.webview2.{source['version']}.nupkg"
    check(hashlib.sha256(archive.read_bytes()).hexdigest() == source["sha256"] == receipt["sdkSha256"], "SDK cache provenance hash")
    check(source["source"].startswith("https://api.nuget.org/v3-flatcontainer/"), "official API requested source")
    code = "\n".join(path.read_text(encoding="utf-8") for path in NATIVE.glob("*.cs"))
    for forbidden in (".ExecuteScript(", ".ExecuteScriptAsync(", "Process.Start(", "SetForegroundWindow(",
                      "dshDesktop", "BrowserWindow", "TcpListener", "System.Net.Http", "app.asar", "better-workspace"):
        check(forbidden not in code, "no forbidden native surface " + forbidden)
    for required_token in ("AreHostObjectsAllowed = false", "AreDevToolsEnabled = false", "PermissionRequested +=",
                           "CoreWebView2PermissionState.Deny", "NewWindowRequested +=", "DownloadStarting +=",
                           "FrameNavigationStarting +=", "ScreenCaptureStarting +=", "SaveAsUIShowing +=",
                           "AddScriptToExecuteOnDocumentCreatedAsync(bridge)",
                           "PostWebMessageAsJson(", "CoreWebView2WebResourceRequestSourceKinds.All",
                           "CoreWebView2HostResourceAccessKind.Deny);"):
        check(required_token in code, "security/lifecycle control exists " + required_token)
    form = (NATIVE / "NavigatorForm.cs").read_text(encoding="utf-8")
    # Input transport is not business permission: test the paired fixed-document refusal,
    # not the old WinForms false gate that also blocked owner-local OLE drag delivery.
    check(re.findall(r"browser\.AllowExternalDrop\s*=\s*(\w+)\s*;", form) == ["true"],
          "one explicit native transport policy enables internal OLE drag delivery")
    renderer = (ROOT / "renderer/workspace-navigator.js").read_text(encoding="utf-8")
    drag_start = renderer[renderer.index("listen(view, 'dragstart'"):renderer.index("listen(document, 'dragover'")]
    drag_over = renderer[renderer.index("listen(document, 'dragover'"):renderer.index("listen(document, 'drop'")]
    drop = renderer[renderer.index("listen(document, 'drop'"):renderer.index("listen(view, 'dragend'")]
    candidate = renderer[renderer.index("function dropCandidate(event)"):renderer.index("function endItemDrag()")]
    check("const target = targetAt(event.target), element = target && renderedTargets().get(target.id)?.element" in drag_start
          and "if (!element || !model.connected || failure || busy() || model.dialog || model.contextMenu || searching || target.disabled" in drag_start
          and "itemDrag = { id: target.id, instance: model.instance, element }" in drag_start,
          "only an admitted local projected item creates the owner-local drag source")
    check("source = itemDrag && targets.get(itemDrag.id)" in candidate
          and "if (!source || itemDrag.instance !== model.instance || !element) return" in candidate,
          "drop revalidates the local source, current instance and projected destination")
    for handler, label in ((drag_over, "dragover"), (drop, "drop")):
        check(handler.index("event.preventDefault()") < handler.index("const candidate = itemDrag && dropCandidate(event)"),
              "document cancels all default " + label + " before checking a local source, including foreign payloads")
    check("event.dataTransfer.dropEffect = candidate?.valid ? 'move' : 'none'" in drag_over,
          "no local valid candidate refuses the drop effect")
    check("if (candidate?.valid) {" in drop and "const { id, targetId, position } = candidate" in drop
          and "void send('drop', { id, targetId, position })" in drop,
          "only the validated typed local candidate supplies the finite drop command")
    check(not re.search(r"\.getData\s*\(|\.files\b|\.items\b", renderer),
          "fixed renderer never reads transfer text, files or items as a business source")
    navigation = form[form.index("core.NavigationStarting +="):form.index("core.FrameNavigationStarting +=")]
    check("navigationStarted || !String.Equals(args.Uri, InitialUrl, StringComparison.Ordinal)" in navigation
          and "{ args.Cancel = true; return; }" in navigation,
          "only the first fixed initial URL can navigate, independent of input transport")
    for event, denial in (
        ("FrameNavigationStarting", "args.Cancel = true;"),
        ("NewWindowRequested", "args.Handled = true;"),
        ("DownloadStarting", "args.Cancel = true; args.Handled = true;"),
        ("PermissionRequested", "args.State = CoreWebView2PermissionState.Deny; args.Handled = true; args.SavesInProfile = false;"),
    ):
        bodies = re.findall(r"core\." + event + r"\s*\+=\s*delegate[^{}]*\{([^{}]*)\};", form)
        check(len(bodies) == 1 and " ".join(bodies[0].split()) == denial,
              "unchanged unconditional native refusal for " + event)
    document = (ROOT / "renderer/workspace-navigator.html").read_text(encoding="utf-8")
    check('content="default-src \'none\'; script-src \'self\'; style-src \'self\'; connect-src \'none\'; '
          'img-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'; frame-src \'none\'"' in document,
          "fixed-document CSP remains closed to foreign resources and frames")
    check(form.index("AddScriptToExecuteOnDocumentCreatedAsync(bridge)") < form.index("Navigate(InitialUrl)"), "bridge installed before initial navigation")
    check(".BeginInvoke(" not in form and "Invoke(action)" in form, "bounded synchronous stdin UI handoff")
    check("RejectReparseChain" not in code, "blanket directory ancestor reparse responsibility retired")
    paths = (NATIVE / "WindowGeometry.cs").read_text(encoding="utf-8")
    check("GetFinalPathNameByHandle(handle" in paths and "GetDriveType(full.Substring(0, 3))" in paths
          and "drive == 4" in paths, "native admission canonicalizes final paths and rejects mapped remote drive roots")
    check("SafePaths.RejectReparseLeaf(path)" in code, "fixed resource and owned geometry leaf protection retained")
    program = (NATIVE / "Program.cs").read_text(encoding="utf-8")
    check('if (args.Length != 6)' in program and 'if (args.Length != 4)' not in program,
          "normal CLI is exactly three pairs with no legacy four-argument fallback")
    check('args[i] == "--state-data" && value.StateData == null' in program,
          "state directory is explicit and unique Host authority")
    for child, parent in (("Assets", "UserData"), ("UserData", "Assets"), ("Assets", "StateData"),
                          ("StateData", "Assets"), ("UserData", "StateData"), ("StateData", "UserData")):
        check(f"SafePaths.Within({child}, {parent})" in program,
              f"canonical pairwise overlap direction {child} within {parent} rejected")
    for root, must_exist in (("Assets", "true"), ("UserData", "dataMustExist"), ("StateData", "dataMustExist")):
        check(f"{root} = SafePaths.LocalDirectory({root}, {must_exist});" in program,
              "shared admission canonicalizes explicit root " + root)
    create = program[program.index("internal void CreateDataDirectories()"):program.index("internal static class Program")]
    check(create.index('if (Mode != "window")') < create.index("AdmitRoots(false)")
          < create.index("Directory.CreateDirectory(UserData)") < create.index("Directory.CreateDirectory(StateData)")
          < create.index("AdmitRoots(true)"), "window-only data creation is re-admitted before and after both creates")
    check(program.count("Directory.CreateDirectory(") == 2 and "Directory.GetParent(" not in program,
          "only the explicit browser and state roots are created; no inferred parent state root")
    check("GeometryStore.Load(options.StateData, areas)" in form and "GeometryStore.Save(options.StateData, geometry)" in form,
          "Form geometry reads and writes stable profile state, not client browser data")
    check("GeometryStore.Load(options.UserData" not in form and "GeometryStore.Save(options.UserData" not in form
          and "CoreWebView2Environment.CreateAsync(null, options.UserData, settings)" in form,
          "browser cache retains per-client identity without geometry-source fallback")
    check(program.index('if (options.Mode == "--version")') < program.index("PrepareRuntime();")
          and program.index('if (options.Mode == "--probe")') < program.index("return RunWindow(options, output);"),
          "exclusive probe/version return before window/data startup")
    focus = form[form.index("private void LocateWindow()"):form.index("internal void Fail(")]
    check("GeometryStore.ForFocus(geometry, Bounds, RestoreBounds, WindowState, WorkingAreas())" in focus,
          "live Locate is wired to geometry owner with current Screen work areas")
    check(focus.index("GeometryStore.ForFocus(") < focus.index("Show();") < focus.index("Activate();"),
          "Locate recovers before showing and activating this Form")
    check("if (relocate) Bounds = recovered.NormalBounds;" in focus and "if (WindowState != target) WindowState = target;" in focus,
          "Locate applies outer recovery and reinstates intended window state")
    check("applyingFocusGeometry || stopping" in form and "finally { applyingFocusGeometry = false; }" in focus,
          "transitional Locate states cannot overwrite tracked normal geometry")
    cwd = Path(__file__).resolve().parent / "bin"
    cwd.mkdir(parents=True, exist_ok=True)
    check(run_cli(executable, ["--version"], cwd)["op"] == "version", "headless version from unrelated CWD")
    probe = run_cli(executable, ["--probe"], cwd)
    check(probe["op"] == "probe" and probe["ok"] and probe["runtimeVersion"], "headless relative SDK loader/runtime availability")
    fixture_id = uuid.uuid4().hex
    forbidden_profile = cwd / ("probe-must-not-create-profile-" + fixture_id)
    unused_user = cwd / ("cli-must-not-create-user-" + fixture_id)
    unused_state = cwd / ("cli-must-not-create-state-" + fixture_id)
    check(not any(path.exists() for path in (forbidden_profile, unused_user, unused_state)),
          "headless side-effect fixtures do not pre-exist")
    overrides = {
        "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER": str(cwd / "nonexistent-browser"),
        "WEBVIEW2_USER_DATA_FOLDER": str(forbidden_profile),
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS": "--remote-debugging-port=9222",
    }
    override_probe = run_cli(executable, ["--probe"], cwd, overrides=overrides)
    check(override_probe["runtimeVersion"] == probe["runtimeVersion"], "inherited runtime path override is cleared")
    check(run_cli(executable, ["--version"], cwd, overrides=overrides)["op"] == "version",
          "version remains exclusive without WebView startup despite overrides")
    check(not forbidden_profile.exists(), "headless probe/version create no profile despite inherited override")
    assets, user, state = str(ROOT / "renderer"), str(unused_user), str(unused_state)
    invalid_arguments = (
        [], ["--url", "https://example.invalid"], ["--probe", "--debug"], ["--version", "--debug"],
        ["--assets", assets, "--user-data", user],  # Old normal CLI must not launch a window.
        ["--assets", assets, "--state-data", state], ["--user-data", user, "--state-data", state],
        ["--assets", "relative", "--user-data", user, "--state-data", state],
        ["--assets", assets, "--user-data", "relative", "--state-data", state],
        ["--assets", assets, "--user-data", user, "--state-data", "relative"],
        ["--assets", assets, "--assets", assets, "--state-data", state],
        ["--assets", assets, "--user-data", user, "--user-data", user],
        ["--assets", assets, "--state-data", state, "--state-data", state],
        ["--assets", assets, "--user-data", user, "--unknown", state],
        ["--probe", "--assets", assets, "--user-data", user, "--state-data", state],
        ["--version", "--assets", assets, "--user-data", user, "--state-data", state],
    )
    for invalid in invalid_arguments:
        value = run_cli(executable, invalid, cwd, 2)
        check(value == {"op": "error", "code": "invalid-arguments"}, "strict invalid arguments fail before GUI/data creation")
    for overlapping in (
        ["--assets", assets, "--user-data", assets, "--state-data", state],
        ["--assets", assets, "--user-data", str(ROOT), "--state-data", state],
        ["--assets", assets, "--user-data", str(ROOT / "renderer" / "browser"), "--state-data", state],
        ["--assets", assets, "--user-data", user, "--state-data", assets],
        ["--assets", assets, "--user-data", user, "--state-data", str(ROOT)],
        ["--assets", assets, "--user-data", user, "--state-data", str(ROOT / "renderer" / "state")],
        ["--assets", assets, "--user-data", user, "--state-data", user],
        ["--assets", assets, "--user-data", user, "--state-data", str(unused_user / "state")],
        ["--assets", assets, "--user-data", str(unused_state / "browser"), "--state-data", state],
    ):
        check(run_cli(executable, overlapping, cwd, 2) == {"op": "error", "code": "unsafe-path"},
              "built artifact rejects equal/ancestor/descendant roots in all pairwise directions before GUI")
    for unsafe_state in (str(ROOT.anchor), r"\\server\share\state", r"\\?\C:\state", r"\\.\C:\state"):
        check(run_cli(executable, ["--assets", assets, "--user-data", user, "--state-data", unsafe_state], cwd, 2)
              == {"op": "error", "code": "invalid-arguments"}, "built state root rejects volume/UNC/device input")
    check(not any(path.exists() for path in (forbidden_profile, unused_user, unused_state)),
          "invalid six-arg and exclusive probe/version paths create neither browser nor state roots")
    bundled = Path(sys.executable).parent.parent / "node/bin/node.exe"
    node = args.node or (bundled if bundled.is_file() else Path(shutil.which("node") or ""))
    if not node.is_file():
        raise RuntimeError("Headless bridge checks require an existing Node executable via --node; no install performed")
    subprocess.run([str(node), str(Path(__file__).with_name("bridge-tests.mjs"))], check=True, cwd=cwd)
    print(json.dumps({"op": "artifact-tests", "passed": PASSED, "runtimeVersion": probe["runtimeVersion"], "guiLaunched": False}))


if __name__ == "__main__":
    main()
