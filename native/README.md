# Windows 原生显示组件

这是 DSH Detached Workspace 独立插件自带的显示程序，不是另一个 DSH、聊天后端或 Agent。它不包含 Node，不导入 DSH 私有 main/preload，也不依赖 Better Workspace 或某个 DSH 安装路径。请安装完整插件，**不要双击显示程序来代替插件启动**。

## 使用条件与部署

面向 Windows x64，需要 .NET Framework 4.6.2 或更高版本，以及系统 Evergreen WebView2 Runtime。普通使用不需要 C# 编译器、dotnet SDK 或 NuGet 客户端。插件不会自动安装系统运行时，也不绕过企业或系统策略。

请保留整个 [win-x64](<win-x64/>) 输出目录，不能只复制可执行文件：

- [WorkspaceNavigator.exe](<win-x64/WorkspaceNavigator.exe>) 与 [配置文件](<win-x64/WorkspaceNavigator.exe.config>)；
- [WebView2 Core](<win-x64/Microsoft.Web.WebView2.Core.dll>)、[WinForms](<win-x64/Microsoft.Web.WebView2.WinForms.dll>) 和 [x64 Loader](<win-x64/WebView2Loader.dll>)；
- [再分发许可](<win-x64/WebView2-LICENSE.txt>) 与 [构建清单](<win-x64/build-manifest.json>)。

DLL 相对可执行文件解析，不依赖工作目录。构建清单记录部署文件校验值和固定 SDK 来源，用于完整性读回；校验值不等于发行者签名验证。当前程序未做代码签名，不承诺所有系统策略都允许执行。

## 数据目录与几何偏好

Host 分别传入固定资源目录、每个客户端独立的 WebView2 缓存目录，以及该配置稳定的窗口偏好目录。浏览器缓存不跨客户端共享，安全绑定标识仍为随机值；窗口位置、正常外框尺寸与最大化偏好由原生 GeometryStore 单独保存，不再以随机客户端缓存作为来源。

同一配置有多个导航窗口时，彼此缓存独立；稳定几何偏好采用最后一次成功的原子保存值，供后续打开恢复。重新打开和“定位”都会按当前显示器有效工作区校正外框。旧开发候选中位于随机目录的几何文件不再自动读取，也不会被迁移、扫描或删除。卸载插件同样不会主动清扫用户偏好目录。

## 插件内部启动契约

普通用户无需手动构造以下参数。Host 必须通过公开托管 subprocess 提供 stdin/stdout/stderr 管道、持续读取输出，并在停用或卸载时等待所属进程范围退出。

窗口模式严格接受三对参数，每对恰好一次，顺序可变：`--assets ABS_RENDERER_DIR --user-data ABS_CLIENT_BROWSER_DIR --state-data ABS_PROFILE_WINDOW_STATE_DIR`。没有旧双目录参数回退，也没有默认猜测 DSH/profile 路径。

三个目录均须为非盘根的本地绝对路径。原生端使用目录句柄解析可信 junction/symlink 的规范路径，拒绝远程、UNC、device、无效路径和映射远程驱动器；三个规范目录任意两者不得相等或互为祖先。创建获授权的缓存和偏好目录前后重新核验。固定资源和几何叶文件不得是重解析点；解析参数本身不创建目录。

`--version` 与 `--probe` 是互斥的无窗口模式，各自只返回一行 JSON 后退出，不创建 Form、控制器、浏览器缓存或偏好目录。probe 仅查询 WebView2 Runtime 是否可用，不代表页面、鼠标、显示器或 DPI 验收通过。

## 页面与权限边界

唯一页面为 `https://navigator.local/workspace-navigator.html`。仅允许读取包内固定的 HTML、JS、CSS；拒绝其他 URL、query、fragment、端口、外部资源、子 frame、二次导航、弹窗和下载，保留页面 CSP。不提供任意脚本、shell、文件、原生对象剪贴板桥或 DSH 主窗控制接口，也没有浏览器标签页或备用后端回退。

WinForms 控件的 `AllowExternalDrop=true` 仅开放输入传输：`false` 在已测组合中还会阻断同页内部 HTML5/OLE 拖放。固定文档对全部 `dragover/drop` 调用 `preventDefault`，只从本页已接纳的 `itemDrag` 与当前投影中校验来源／实例／目标，不把 `DataTransfer` 文本或文件解析为业务命令；外部文件／URL 不得打开、导入或导航。实际业务仍由 Main 重验，固定导航、子 frame、新窗、下载与权限拒绝不变，没有自定义原生拖放业务或额外桥。

隔离单变量 A/B 仅改变上述控件策略及重编产物，已观察到同区会话移出组、手动／活动排序切换，以及外部 OS 文件和 URL 拖入未打开／导入／导航。这是采用输入策略的有限现场证据，不是当前源码完整新候选的 GUI 验收、所有来源／时序的安全认证或其他 DPI／设备组合验证。

固定页面可为现有“复制 Session ID”执行非业务的标准 Web `navigator.clipboard.writeText`：精确文本只能来自 Main 点击时重验后的一次有界授权，页面不从标题或投影 ID 猜测。每个实例／授权 ID 至多写一次，真实 Promise 结果才产生有限回执；收回或撤销后不把迟到结果绑定给新动作。已开始的 Web 写入无法取消，不承诺回滚。没有剪贴板读取、C#／Host writer、额外权限或失败 fallback；该路径不等于显示程序获得通用 OS 能力。

固定顶层页面只得到 `ready`、`rendered`、`command`、`subscribe` 四项桥能力。Host/shared protocol 仍负责业务身份、revision、动作白名单和目标验证；页面与显示程序都不是工作区或会话状态的写入所有者。

权限请求、证书绕过、认证弹窗、屏幕捕获、保存网页、自动填充和密码保存等均被拒绝，开发者工具和调试端口不开放。子进程启动时清除继承的 `WEBVIEW2_*` 覆盖变量，防止其改写缓存、浏览器路径或调试选项；不修改父进程或系统环境。

## 管道、显示与关闭

传输是无 BOM UTF-8 的单行 JSON，接受 LF 或 CRLF。stdout 仅协议，stderr 仅稳定错误代码与异常类型；不记录模型内容、用户标识或完整路径。内层负载上限为 4,194,304 UTF-8 字节，整帧上限为 4,195,328 字节（不含 LF）。无效 UTF-8、重复 JSON 字段、未知操作、截断或过大帧等均失败关闭。

Host 向显示程序发送 `model/result/focus/close`；程序返回 `started/ready/rendered/command/error/closed`。`started` 或 `ready` 不是当前模型已显示的证明。只有当前匹配的 renderer `rendered` 才满足打开就绪条件。公开 Windows subprocess 会隐藏原生程序的初始窗口，因此 Host 在每个显式打开就绪周期发送一次既有 `focus`；普通数据更新不会抢焦点。

`focus` 只定位、恢复和激活本窗口，不操作 DSH 主窗。`closed.bounds` 是正常外框，不是网页内容区或最小化尺寸。窗口保留系统标题栏、移动、调整大小、最小化、最大化和关闭能力；早期内部候选曾补测标题栏拖动、系统菜单键盘调整、最小化后定位、关闭和 150%／125% 双屏移动。这些是原生组件的历史有限测试，不代表当前整个插件组合或其他设备已经验收。

stdin EOF、协议错误、关闭和超时等进入同一幂等终止流程；未完成页面请求结算失败，WebView2 控件和环境释放后才退出。Host 随后等待公开托管范围清空，不能把顶层进程退出或一条关闭消息冒充所有子进程已回收。

## 开发者说明

完整源码仓库中的构建脚本使用 Framework64 C# 编译器，以 C# 5、x64 GUI 子系统和 warnings-as-errors 编译。SDK 固定为 Microsoft.Web.WebView2 1.0.4314.35；已打包用户不需要运行构建脚本。固定缓存缺失或校验失败时构建失败，不会默默下载或修补；首次获取 SDK 需开发者明确选择获取步骤。记录的源 URL、最终 URL 与 SHA256 是来源和完整性回执，不应冒充 NuGet 发行签名验收。

无窗口测试用于检查参数/路径、安全策略、协议、几何归一化和产物校验。早期内部候选的隔离实测另覆盖过原生物理点击到真实 Main、草稿保留、实际中文输入与选中状态对照、搜索与键盘、标题栏、手动几何重开和 150%→125%→150% 跨屏；这不是公开改名版的完整组合验收。实际拔屏／热插拔与大型真实数据的人工滚动仍未验证，不以源码或无窗口测试冒充。整个插件的状态与安装边界以[主说明](<../README.md>)为准。
