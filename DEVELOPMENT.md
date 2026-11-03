# 开发与构建

[返回中文首页](<README.md>) · [English overview](<README.en.md>)

## 源码组成

- [src](<src/>)：Host/Client 和 TypeScript 协议。Client 为直接交付的 JavaScript，不需要改动 DSH Web 主程序。
- [renderer](<renderer/>)：原生显示程序唯一允许加载的固定页面及资源。
- [native](<native/>)：C#5/.NET Framework WinForms/WebView2 显示程序源码；[win-x64](<native/win-x64/>) 为随包发行组件，包含构建散列与再分发许可。
- [tests](<tests/>)：协议、Host 生命周期、真实 SDK 组合、DOM/交互、原生静态与载荷闭合检查。

## 开发依赖

推荐 Node.js 24 与 pnpm 11，原生重建另外需要 Windows x64、Python 3 和 Framework64 C# 编译器。终端用户只安装 Release tgz，不需要下列开发工具。

部分组合测试使用真实 DSH store、图标、Cordis 和 SessionProjectionRegistry，**需要单独准备已构建的兼容 DSH 源码检出**。这不是本插件的运行依赖；也不需要 Better Workspace、AgentTeams 或用户生产 profile。请按 [DeepSeek Harness 开发文档](<https://github.com/deepseek-ai/DeepSeek-Harness>) 准备对应版本并构建其产物。本候选对应 SDK 包版本为 `0.2.1-rc.3`；不要将未构建或不同 API 的源码目录当作已验证环境。

插件开发副本安装依赖：

```sh
pnpm install
pnpm run check
```

[pnpm-workspace.yaml](<pnpm-workspace.yaml>) 禁用隐式自动安装 peers，防止为了开发检查而额外拉取或启动整个 DSH。Zod 为运行依赖，TypeScript 为本仓库开发依赖；DSH 本身由宿主提供。

组合测试通过一个显式的 `DSH_SOURCE_ROOT` 定位上述 SDK，没有指向维护者机器的默认路径或同级目录回退。将下面路径换成自己的已构建源码检出：

PowerShell：

```powershell
$env:DSH_SOURCE_ROOT = (Resolve-Path ..\DeepSeek-Harness).Path
pnpm test
```

Bash：

```sh
DSH_SOURCE_ROOT="$(cd ../DeepSeek-Harness && pwd)" pnpm test
```

测试会只读该 SDK 的依赖及产物，使用临时 DOM、假托管进程和测试会话数据，不触碰生产配置，不启动 GUI。真实窗口验收需单独进行；测试通过不表示该验收已完成。

## 协议与原生程序

修改协议后生成产物：

```sh
pnpm run build:protocol
pnpm run check
```

只改 JS/CSS 或发布名称不需要重建原生二进制。原生源码有变更时，在 Windows 开发机上运行：

```sh
python scripts/build-native.py --fetch-sdk --test
```

脚本只从固定官方 NuGet 来源取得 `Microsoft.Web.WebView2 1.0.4314.35`，保留 SDK 来源及散列，产物清单记录 EXE/DLL/许可的散列；不会安装系统运行时、启动桌面窗口或修改全局工具链。重建不要求产生逐字节相同的 EXE：Framework 编译器可能记录构建时间，提交时应核对自己的产物和新清单一致，而不是沿用旧散列。

## 打包

在设置好 SDK 环境后运行：

```sh
pnpm run pack:release
```

安装包生成在被 Git 忽略的 dist 目录。普通使用者下载 Release 中的 `.tgz`，不是 GitHub 自动源码 ZIP。[package.json](<package.json>) 的 files 白名单决定安装载荷，开发测试、SDK 缓存与工作日志不进入 tgz。

发布时另行生成 SHA256SUMS，并在 GitHub Release 附加 tgz 与校验文件。源码仓库和包内容分别核查：可编译源码不代表安装载荷完整，散列一致也不等于发行者签名验证。当前不自动发布 npm，不需要在开发环境配置 npm 凭据。

## 改名必须保持的兼容名称

公开包／客户端模块名为 `dsh-workspace-detached`，但下列名字由既有安装数据、WireProtocol 或固定资源策略使用，**不要进行全文替换**：

- Cordis entry id、configForms key、settingsScope namespace：`workspace-navigator`。
- Locale 与存储：`workspaceNavigator`、`dsh.workspaceNavigator.view.v1`、`dsh.workspaceNavigator.titles.v1`。
- 活动投影键：`workspaceNavigatorActivity`。
- RPC：`/workspace-navigator`；profile 数据：`data/workspace-navigator`。
- 原生固定 URL：`https://navigator.local/workspace-navigator.html`，及同名前缀 JS/CSS、`WorkspaceNavigator.exe`、原生消息类型和错误码。

现有用户需先停用旧内部包再安装新包；发布不自动改写用户 profile，不能同时启用新旧包。保留键能避免无谓重置，但不能据此声称所有宿主的旧包→新包自动迁移已实测。

## 维护原则

不修改 DSH Core，不读取另一个功能插件的运行时实现，不把物理路径移动与逻辑导航重排混为一谈。会话动作仍由主窗口业务服务处理，复制项为精确 Session ID，归档恢复仍由宿主主界面负责。新 UI、生命周期或协议变动请补充对应回归，并与真实 GUI 验收结果分别描述。
