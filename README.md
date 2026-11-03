# DSH Detached Workspace

**把工作区与会话导航从 DSH 侧栏分离出来，放进可独立移动、调整大小的 Windows 窗口。**

[English](<README.en.md>) · [下载预览版](<https://github.com/liushimu/dsh-workspace-detached/releases>) · [反馈问题](<https://github.com/liushimu/dsh-workspace-detached/issues>) · [开发说明](<DEVELOPMENT.md>)

> 当前为 **0.2.3 预览版**。它是第三方独立插件，不是 DSH 官方功能或 Better Workspace 补丁。使用公开插件接口，不修改 DSH 主程序；卸载 Better Workspace 后仍可独立使用。“独立”指导航窗口和插件实现，并不表示可以脱离 DSH 单独运行。

## 能做什么

- **独立导航窗口**：从侧栏“弹出工作区”，在另一块屏幕或桌面位置管理导航；需要时“收回侧栏”。窗口不是第二个聊天后端，也不会因为弹出而新建 Agent。
- **保留层级与分组**：显示工作区、路径嵌套、名称分组和会话；支持总览、聚焦工作区及底部预览。
- **逻辑拖放与排序**：调整导航父级及同级顺序，选择按内容活动或手动排序；逻辑调整不搬动磁盘目录。
- **沿用 DSH 的会话动作**：选择、重命名、归档、移动等能力由主窗口对应服务完成；菜单是否可用取决于宿主能力与会话状态。复制项复制的是 **Session ID**，不是聊天内容。
- **适合长期开着的呈现**：搜索与折叠、可拖动的上下分区、默认标题字号区分、显式自定义外观，以及六格活跃点阵；系统要求减少动态效果时停用点阵动画。

## 系统要求

- Windows x64。
- .NET Framework **4.6.2 或以上**。
- Microsoft Edge **WebView2 Evergreen Runtime**，需由系统或用户自行安装；插件不会自动安装系统运行时。
- DSH 声明兼容起点为 **0.2.1-rc.3**，Node.js **22.19 或以上**。宿主需提供公开的 Connection、webServer、subprocess、sessionProjections 与相关客户端槽位。

普通安装使用不需要 C# 编译器、Python、dotnet SDK 或 DSH 源码。其他操作系统的原生窗口暂不支持。DSH 仍处于接口演进阶段；版本声明和日常升级兼容的设计目标，不代表所有未来版本都经过实测。

## 安装

1. 从 [Releases](<https://github.com/liushimu/dsh-workspace-detached/releases>) 下载 `dsh-workspace-detached-0.2.3.tgz`，不要把 GitHub 自动生成的 Source code 压缩包当作安装包，也不必解压 tgz。
2. 若启用了 Better Workspace，先在 DSH 中停用它；两个插件占用同一侧栏位置，不应同时启用。
3. 在 DSH 的插件管理入口添加下载的本地 tgz，并启用 **dsh-workspace-detached**。不同宿主版本的入口文字可能不同，请以宿主实际插件管理界面为准。
4. 回到工作区侧栏，点击 **“弹出工作区”**。若新安装尚未被客户端加载，按宿主提示重新加载客户端。

也可在**目标配置的 DSH 宿主已停止**时使用官方 CLI，例如默认桌面配置：

```sh
dsh plugin --profile desktop add ./dsh-workspace-detached-0.2.3.tgz
```

请将配置名和文件位置换成实际值。不要在宿主或独立窗口运行时，直接覆盖其 node_modules、EXE 或 DLL。不要双击包内显示程序代替插件启动。

## 使用

- **弹出／收回**：弹出后侧栏保留导航窗口状态入口；“定位导航窗口”找回已有窗口，“收回侧栏”结束该窗口的独立显示。
- **总览／聚焦**：进入一个工作区后，上方显示聚焦内容，下方预览其他工作区；可返回总览。
- **调整分区**：拖动中间手柄；焦点在手柄时，上下键微调，Shift 加快，Home/End 到边界，双击或 Enter 恢复默认。上下区域有最小高度；分区比例仅保留在当前窗口文档，新窗口恢复默认。
- **整理层级**：逻辑导航父级、名称分组、物理目录和会话归属不是同一件事。拖放调整导航层级不搬目录；菜单中的“移至工作区”则会改变会话运行目录，并在需要时提示确认。
- **活动时间**：活动排序以用户内容和非空助手回复为依据，不把工具事件、标题修改等管理动作当作新内容。部分历史会话的活动时间可能尚未补齐。
- **归档恢复**：可执行归档；恢复已归档会话请使用 DSH 主窗口／设置中宿主提供的归档管理入口，本插件不另设恢复管理器。

## 更新、旧名称与卸载

公开包名由内部开发名 `dsh-workspace-navigator` 改为 `dsh-workspace-detached`。内部偏好键、Cordis entry id、RPC、数据目录和原生资源文件名仍保留兼容名称，源码中见到 `workspaceNavigator` 或 `workspace-navigator` 属于有意保留，不是对旧包的运行依赖。

- **首次从旧候选切换**：先备份当前 DSH 配置并停用旧候选。安装新包前确认旧插件不再启用；若宿主报告相同 entry id 冲突，先通过官方管理器移除旧包，勿手改配置或清空数据。不要同时启用新旧包。此改名发布不宣称已完成所有宿主版本的自动迁移验收。
- **后续更新**：通过宿主插件管理器更新同名包；保留数据目录，不做热替换。
- **卸载**：先收回窗口，再用宿主插件管理器停用／卸载。插件不会删除工作区目录、会话或主动清扫偏好数据。

## 数据与安全范围

插件只提供导航与呈现，不创建第二套会话后端。会话管理动作通过 DSH 主窗口公开服务执行；不会直接修改 DSH 安装文件或读取 Better Workspace 的运行时 store/DOM。

原生程序仅加载包内固定 HTML/JS/CSS，通过受限的消息协议与所属主窗口通信，不提供任意网页、脚本、shell 或通用文件浏览入口。它使用的拖放不接纳外部文件或 URL。源码和发行包不包含维护者的私人配置、登录凭据或会话记录。

原生数据默认位于当前 DSH profile 的 `data/workspace-navigator`；WebView2 客户端缓存相互隔离，窗口几何偏好位于其稳定的 `window-state` 子目录。浏览器侧视图、标题缓存与 profile 配置的保存位置不同，改名不会自动扫描或导入 Better Workspace 的旧数据。

## 已知限制与验证边界

- 当前显示程序未做代码签名；Windows 安全或企业策略可能限制运行。请自行核验来源，不建议绕过系统策略。
- 原生窗口仅支持 Windows x64，不包含完整聊天界面；已有多个 DSH 主窗口的配套行为依赖宿主生命周期服务。
- 自动化覆盖了模型／协议、Host 生命周期、Native DOM/SVG/CSS 交互及包内容，但 **DOM 模拟不等于真实 WebView2 的物理点击、DPI、拖放或动画观感验收**。当前层级拖放、字体、分隔条及点阵的完整 GUI 组合仍待实际确认；不会把早期候选的测试当作当前版本全部通过。
- 没有跨所有 DSH 版本、屏幕布局、输入法和安全策略的保证。原生启动不可用时会报告问题，并尽量恢复主侧栏，不提供另开普通网页的替代后端。

反馈时请提供 DSH/插件版本、Windows 与 WebView2 版本、复现步骤和必要截图。请先遮盖路径、会话标题、聊天内容和凭据。截图尚未随首次公开候选提供，避免使用含私人工作区内容的开发截图。

## 开发与许可证

参见 [开发说明](<DEVELOPMENT.md>)、[更新记录](<CHANGELOG.md>)、[MIT 许可证](<LICENSE>) 与 [第三方许可说明](<THIRD_PARTY_NOTICES.md>)。

分组及侧栏逻辑改编自 [KannaKuron/dsh-better-workspace](<https://github.com/KannaKuron/dsh-better-workspace>)；固定导航实现基于 DeepSeek Harness 的本地原型；活跃点阵改编自 [NanmiCoder/dsh-agent-teams](<https://github.com/NanmiCoder/dsh-agent-teams>) 的 WorkGlyph。原生包保留 Microsoft WebView2 SDK 再分发许可。这些复用不构成对 Better Workspace 或 AgentTeams 的运行依赖，也不表示原作者或 DSH 官方为本插件背书。
