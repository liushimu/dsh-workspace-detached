# DSH Detached Workspace

**Move workspace and session navigation out of the DSH sidebar into a separate, movable and resizable Windows window.**

[简体中文](<README.md>) · [Preview downloads](<https://github.com/liushimu/dsh-workspace-detached/releases>) · [Issues](<https://github.com/liushimu/dsh-workspace-detached/issues>) · [Development guide](<DEVELOPMENT.md>)

> **0.2.3 preview.** This is an independent, third-party plugin, not an official DSH feature or a patch to Better Workspace. It uses public plugin interfaces and does not modify DSH Core. Better Workspace and AgentTeams are not runtime dependencies. The window still requires a running DSH host: it is not a standalone chat application.

## Features

- Detach workspace navigation into its own Windows window and return it to the sidebar when needed.
- Keep workspace nesting, name groups and sessions in one hierarchy, with overview, focused-workspace and bottom-preview views.
- Organize logical navigation parents and choose content-activity or manual sibling ordering without moving physical directories.
- Use the main window's session-management services. Menu availability follows the host and session state. The copy action copies the exact **Session ID**, not chat contents.
- Search and collapse rows; resize the focused/preview split; distinguish default group and session typography; retain explicit appearance settings.
- Show a six-square activity glyph, with staggered opacity animation and a static reduced-motion presentation.

## Requirements

Windows x64, .NET Framework 4.6.2 or later, and the system-installed Microsoft Edge WebView2 Evergreen Runtime. The plugin does not install system runtimes. Normal use requires neither a C# compiler nor Python, dotnet SDK or a DSH source checkout.

The declared DSH floor is `0.2.1-rc.3`, with Node.js `22.19` or later and the required public Connection, webServer, subprocess, session-projection and client-slot capabilities. These interfaces are evolving: the version declaration is not a promise that every future DSH release has been tested. Other native-window platforms are not currently supported.

## Installation

1. Download `dsh-workspace-detached-0.2.3.tgz` from [Releases](<https://github.com/liushimu/dsh-workspace-detached/releases>). Do not use GitHub's automatic Source code archive as the install package; do not unpack the tgz.
2. Disable Better Workspace if enabled. Both plugins occupy the same sidebar position and should not run together.
3. Add the local tgz through the DSH plugin manager and enable **dsh-workspace-detached**. Exact menu labels vary by host version.
4. Use **Pop out workspaces** in the sidebar. If necessary, reload the client as instructed by the host.

Alternatively, with the target profile's DSH host **stopped**, the official CLI can install the package. For the usual desktop profile:

```sh
dsh plugin --profile desktop add ./dsh-workspace-detached-0.2.3.tgz
```

Adjust the profile and path to your environment. Never hot-replace package files, EXE or DLLs while the host or detached window is running, and do not double-click the native carrier as an alternative to plugin startup.

## Usage

Locate an existing detached window or return it to the sidebar through the corresponding controls. In focused view, drag the horizontal separator between the workspace tree and other-workspace previews. With the separator focused, arrow keys adjust the split, Shift changes it faster, Home/End move to its bounds, and Enter or double-click resets it. Both regions retain minimum heights; the ratio belongs to the current window document and resets in a new window.

Logical parent changes do not move files or change session ownership. The explicit **Move to workspace** session action is different: it changes the session working directory through the host and shows confirmation when required. Content-activity ordering counts surfaced human messages and nonempty assistant responses, not administrative or tool-only events. Some historical activity times can be unavailable.

Archiving is available; use the host's main-window/settings archive management to restore archived sessions. The plugin does not add another restore manager.

## Updates and the former development name

The public package is renamed from the internal candidate `dsh-workspace-navigator`. Existing `workspaceNavigator` preference/projection keys and `workspace-navigator` entry id, RPC, data directory and native resource filenames intentionally remain unchanged. They are not a dependency on the old package.

For an initial switch from the old candidate, back up the DSH profile and disable the old package first. Do not enable old and new packages together. If the host reports a duplicate entry id, remove the old package through the official manager before adding the new one; do not clear preferences or hand-edit the profile. This release does not claim a universally tested automatic rename migration.

For later updates, use the host's manager and retain the data directory. To uninstall, return the window to the sidebar, then disable/remove the plugin through the manager. The plugin does not delete workspace directories, sessions or preference data.

## Data, safety and limitations

The native carrier loads only its packaged HTML/JS/CSS and uses a restricted message protocol with its owning main window. It is not a general browser, shell, file browser or second chat backend, and it does not accept external-file/URL drops. The repository and release payload exclude the maintainer's private configuration, credentials and conversation records.

Native state defaults to the current DSH profile's `data/workspace-navigator`, with per-client WebView2 caches and a stable `window-state` directory for geometry. Browser view preferences and profile configuration have separate owners. This rename does not scan or import Better Workspace data.

The native carrier is currently **unsigned**; Windows or enterprise policies may prevent execution. Verify the source and do not bypass system policy. Automated model, protocol, lifecycle, DOM/SVG/CSS and payload checks are not physical WebView2, DPI, drag-and-drop, clipboard or animation acceptance. The latest hierarchy/splitter/typography/glyph combination still needs real GUI confirmation. Earlier-candidate evidence is not a full acceptance claim for this release.

There is no all-versions, all-display-layouts or all-input-method guarantee. Native startup failure is reported and the main sidebar is restored where possible; there is no alternate browser-window backend. No private-workspace screenshots are included in the initial public candidate. When reporting an issue, include relevant versions and reproduction steps, and redact paths, session titles, conversation content and credentials.

## Development and licenses

See [DEVELOPMENT](<DEVELOPMENT.md>), [CHANGELOG](<CHANGELOG.md>), [MIT license](<LICENSE>) and [third-party notices](<THIRD_PARTY_NOTICES.md>).

Grouping/sidebar code is adapted from [KannaKuron/dsh-better-workspace](<https://github.com/KannaKuron/dsh-better-workspace>); the fixed navigator implementation is based on a DeepSeek Harness local prototype; the activity glyph adapts the WorkGlyph from [NanmiCoder/dsh-agent-teams](<https://github.com/NanmiCoder/dsh-agent-teams>). The native payload retains the Microsoft WebView2 SDK redistribution license. Reuse implies neither a runtime dependency on those feature plugins nor endorsement by their authors or DSH.
