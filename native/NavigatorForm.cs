using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WorkspaceNavigator
{
    internal sealed class NavigatorForm : Form
    {
        private const string InitialUrl = AssetPolicy.InitialUrl;
        private readonly Options options;
        private readonly WireOutput output;
        private readonly WebView2 browser;
        private readonly Dictionary<string, long> pending = new Dictionary<string, long>(StringComparer.Ordinal);
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly System.Windows.Forms.Timer deadlines = new System.Windows.Forms.Timer();
        private GeometryState geometry;
        private CoreWebView2Environment environment;
        private string latestModel;
        private volatile bool stopping;
        private bool rendererReady;
        private bool navigationStarted;
        private bool adjustingDpi;
        private bool applyingFocusGeometry;
        private ulong initialNavigationId;
        internal bool Failed { get; private set; }

        internal NavigatorForm(Options settings, WireOutput writer)
        {
            options = settings; output = writer;
            Text = "Workspace Navigator";
            FormBorderStyle = FormBorderStyle.Sizable;
            MaximizeBox = true; MinimizeBox = true; ControlBox = true; ShowIcon = false;
            StartPosition = FormStartPosition.Manual;
            // No designer's 96-DPI client-size autoscaling: saved coordinates are physical OUTER bounds.
            // WebView2 handles CSS/DPR scaling; WM_DPICHANGED applies the OS's suggested outer frame once.
            AutoScaleMode = AutoScaleMode.None;
            Rectangle[] areas = WorkingAreas();
            geometry = GeometryStore.Load(options.StateData, areas);
            Rectangle area = Screen.FromRectangle(geometry.NormalBounds).WorkingArea;
            MinimumSize = new Size(Math.Min(360, area.Width), Math.Min(300, area.Height));
            Bounds = geometry.NormalBounds;
            if (geometry.Maximized) WindowState = FormWindowState.Maximized;
            browser = new WebView2();
            browser.Dock = DockStyle.Fill;
            // WinForms false blocks our internal OLE drags too. Enable transport only: the fixed
            // renderer rejects foreign sources; navigation/download/permission guards remain unchanged.
            browser.AllowExternalDrop = true;
            browser.DefaultBackgroundColor = Color.FromArgb(30, 30, 30);
            Controls.Add(browser);
            deadlines.Interval = 1000;
            deadlines.Tick += ExpireRequests;
        }
        private static Rectangle[] WorkingAreas()
        {
            Screen[] screens = Screen.AllScreens;
            Rectangle[] result = new Rectangle[screens.Length];
            for (int i = 0; i < screens.Length; i++) result[i] = screens[i].WorkingArea;
            return result;
        }
        protected override async void OnShown(EventArgs args)
        {
            base.OnShown(args);
            TrackGeometry();
            Thread reader = new Thread(InputLoop);
            reader.IsBackground = true; reader.Name = "workspace-navigator-stdin"; reader.Start();
            try
            {
                CoreWebView2EnvironmentOptions settings = new CoreWebView2EnvironmentOptions();
                settings.AllowSingleSignOnUsingOSPrimaryAccount = false;
                settings.AreBrowserExtensionsEnabled = false;
                settings.IsCustomCrashReportingEnabled = true;
                settings.AdditionalBrowserArguments = "--disable-background-networking --disable-component-update --disable-sync --no-first-run --no-default-browser-check";
                environment = await CoreWebView2Environment.CreateAsync(null, options.UserData, settings);
                if (stopping) return;
                await browser.EnsureCoreWebView2Async(environment);
                if (stopping) return;
                ConfigureCore(browser.CoreWebView2);
                string bridge;
                using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("WorkspaceNavigator.Bridge.js"))
                using (StreamReader source = new StreamReader(stream, WireProtocol.Utf8)) bridge = source.ReadToEnd();
                await browser.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(bridge);
                if (stopping) return;
                deadlines.Start();
                output.Send("{\"op\":\"started\"}");
                browser.CoreWebView2.Navigate(InitialUrl);
            }
            catch (Exception error) { if (!stopping) Fail("load-failed", error); }
        }
        private void ConfigureCore(CoreWebView2 core)
        {
            CoreWebView2Settings settings = core.Settings;
            settings.IsScriptEnabled = true;
            settings.IsWebMessageEnabled = true;
            settings.AreHostObjectsAllowed = false;
            settings.AreDefaultContextMenusEnabled = false;
            settings.AreDefaultScriptDialogsEnabled = false;
            settings.AreDevToolsEnabled = false;
            settings.AreBrowserAcceleratorKeysEnabled = false;
            settings.IsStatusBarEnabled = false;
            settings.IsBuiltInErrorPageEnabled = false;
            settings.IsGeneralAutofillEnabled = false;
            settings.IsPasswordAutosaveEnabled = false;
            settings.IsZoomControlEnabled = false;
            settings.IsPinchZoomEnabled = false;
            settings.IsSwipeNavigationEnabled = false;
            settings.IsNonClientRegionSupportEnabled = false;
            core.SetVirtualHostNameToFolderMapping("navigator.local", options.Assets, CoreWebView2HostResourceAccessKind.Deny);
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All,
                CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += delegate(object sender, CoreWebView2WebResourceRequestedEventArgs args)
            {
                if (!AssetPolicy.Allowed(args.Request.Uri, args.Request.Method))
                    args.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Forbidden", "Content-Type: text/plain\r\nContent-Security-Policy: default-src 'none'\r\n");
            };
            core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs args)
            {
                if (navigationStarted || !String.Equals(args.Uri, InitialUrl, StringComparison.Ordinal))
                { args.Cancel = true; return; }
                navigationStarted = true; initialNavigationId = args.NavigationId;
            };
            core.FrameNavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs args) { args.Cancel = true; };
            core.NavigationCompleted += delegate(object sender, CoreWebView2NavigationCompletedEventArgs args)
            { if (!stopping && args.NavigationId == initialNavigationId && !args.IsSuccess) Fail("navigation-failed", null); };
            core.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs args) { args.Handled = true; };
            core.DownloadStarting += delegate(object sender, CoreWebView2DownloadStartingEventArgs args) { args.Cancel = true; args.Handled = true; };
            core.PermissionRequested += delegate(object sender, CoreWebView2PermissionRequestedEventArgs args)
            { args.State = CoreWebView2PermissionState.Deny; args.Handled = true; args.SavesInProfile = false; };
            core.LaunchingExternalUriScheme += delegate(object sender, CoreWebView2LaunchingExternalUriSchemeEventArgs args) { args.Cancel = true; };
            core.BasicAuthenticationRequested += delegate(object sender, CoreWebView2BasicAuthenticationRequestedEventArgs args) { args.Cancel = true; };
            core.ClientCertificateRequested += delegate(object sender, CoreWebView2ClientCertificateRequestedEventArgs args) { args.Cancel = true; args.Handled = true; };
            core.ServerCertificateErrorDetected += delegate(object sender, CoreWebView2ServerCertificateErrorDetectedEventArgs args) { args.Action = CoreWebView2ServerCertificateErrorAction.Cancel; };
            core.ContextMenuRequested += delegate(object sender, CoreWebView2ContextMenuRequestedEventArgs args) { args.Handled = true; };
            core.SaveAsUIShowing += delegate(object sender, CoreWebView2SaveAsUIShowingEventArgs args) { args.Cancel = true; args.SuppressDefaultDialog = true; };
            core.ScreenCaptureStarting += delegate(object sender, CoreWebView2ScreenCaptureStartingEventArgs args) { args.Cancel = true; args.Handled = true; };
            core.ProcessFailed += delegate(object sender, CoreWebView2ProcessFailedEventArgs args) { if (!stopping) Fail("runtime-process-failed", null); };
            core.DocumentTitleChanged += delegate
            {
                string title = core.DocumentTitle ?? "";
                System.Text.StringBuilder safe = new System.Text.StringBuilder();
                foreach (char item in title) if (!Char.IsControl(item) && safe.Length < 128) safe.Append(item);
                Text = safe.Length == 0 ? "Workspace Navigator" : safe.ToString();
            };
            core.WebMessageReceived += ReceiveRendererMessage;
        }
        private void ReceiveRendererMessage(object sender, CoreWebView2WebMessageReceivedEventArgs args)
        {
            if (stopping) return;
            try
            {
                if (!String.Equals(args.Source, InitialUrl, StringComparison.Ordinal)) throw new ProtocolException("invalid-renderer-source");
                string raw = args.WebMessageAsJson;
                if (raw.Length > WireProtocol.MaxCarrierBytes) throw new ProtocolException("frame-too-large");
                WireMessage message = WireProtocol.Parse(raw, false);
                raw = WireProtocol.Compact(raw);
                if (pending.ContainsKey(message.Id)) throw new ProtocolException("duplicate-request");
                if (pending.Count >= WireProtocol.MaxPending)
                { browser.CoreWebView2.PostWebMessageAsJson(WireProtocol.Failure(message.Id, "too-many-pending")); return; }
                pending.Add(message.Id, clock.ElapsedMilliseconds + 30000);
                if (message.Op == "ready")
                {
                    rendererReady = true;
                    if (latestModel != null)
                    { browser.CoreWebView2.PostWebMessageAsJson(latestModel); latestModel = null; }
                }
                // Never invent rendered: only the existing renderer's actual acknowledgement reaches Host.
                output.Send(raw);
            }
            catch (ProtocolException error) { Fail(error.Message, error); }
            catch (Exception error) { Fail("transport-failed", error); }
        }
        private void ExpireRequests(object sender, EventArgs args)
        {
            if (stopping) return;
            List<string> expired = new List<string>();
            foreach (KeyValuePair<string, long> entry in pending)
                if (clock.ElapsedMilliseconds >= entry.Value) expired.Add(entry.Key);
            try
            {
                foreach (string id in expired)
                { pending.Remove(id); browser.CoreWebView2.PostWebMessageAsJson(WireProtocol.Failure(id, "reply-timeout")); }
            }
            catch (Exception error) { Fail("transport-failed", error); }
        }
        private void InputLoop()
        {
            try
            {
                BoundedLineReader reader = new BoundedLineReader(Console.OpenStandardInput());
                while (!stopping)
                {
                    string line = reader.ReadLine();
                    if (line == null) { Dispatch(delegate { Close(); }); return; }
                    WireMessage message = WireProtocol.Parse(line, true);
                    // Synchronous UI handoff gives pipe backpressure instead of an unbounded BeginInvoke queue.
                    Dispatch(delegate { ReceiveHostMessage(message, line); });
                    if (message.Op == "close") return;
                }
            }
            catch (ProtocolException error) { Dispatch(delegate { Fail(error.Message, error); }); }
            catch (IOException error) { Dispatch(delegate { Fail("stdin-failed", error); }); }
            catch (Exception error) { if (!stopping) Dispatch(delegate { Fail("transport-failed", error); }); }
        }
        private void Dispatch(Action action)
        {
            if (stopping || IsDisposed || !IsHandleCreated) return;
            try { Invoke(action); }
            catch (InvalidOperationException) { }
        }
        private void ReceiveHostMessage(WireMessage message, string line)
        {
            if (stopping) return;
            if (message.Op == "close") { Close(); return; }
            if (message.Op == "focus")
            {
                LocateWindow(); return;
            }
            try
            {
                if (message.Op == "model")
                {
                    if (!rendererReady) latestModel = line;
                    else browser.CoreWebView2.PostWebMessageAsJson(line);
                }
                else if (message.Op == "result")
                {
                    // Results arriving after bounded expiry cannot resolve a different request.
                    if (!pending.Remove(message.Id)) { Program.Diagnostic("late-or-unknown-result", null); return; }
                    browser.CoreWebView2.PostWebMessageAsJson(line);
                }
            }
            catch (Exception error) { Fail("transport-failed", error); }
        }
        private void LocateWindow()
        {
            Rectangle normal = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            GeometryState recovered = GeometryStore.ForFocus(geometry, Bounds, RestoreBounds, WindowState, WorkingAreas());
            FormWindowState target = recovered.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
            applyingFocusGeometry = true;
            try
            {
                // WinForms cannot set RestoreBounds directly. Only when relocation is necessary,
                // apply the repaired normal outer frame while Normal, then reinstate maximization.
                bool relocate = normal != recovered.NormalBounds;
                if (relocate && WindowState != FormWindowState.Normal) WindowState = FormWindowState.Normal;
                Rectangle area = Screen.FromRectangle(recovered.NormalBounds).WorkingArea;
                MinimumSize = new Size(Math.Min(360, area.Width), Math.Min(300, area.Height));
                if (relocate) Bounds = recovered.NormalBounds;
                if (WindowState != target) WindowState = target;
                geometry = recovered;
                Show();
            }
            finally { applyingFocusGeometry = false; }
            Activate(); browser.Focus();
        }
        internal void Fail(string code, Exception error)
        {
            if (stopping) return;
            Failed = true;
            Program.Diagnostic(code, error);
            try { output.Error(code); }
            catch (IOException) { }
            Close();
        }
        private void TrackGeometry()
        {
            if (geometry == null || !Visible || adjustingDpi || applyingFocusGeometry || stopping) return;
            if (WindowState == FormWindowState.Normal)
            { geometry.NormalBounds = Bounds; geometry.Maximized = false; }
            else if (WindowState == FormWindowState.Maximized) geometry.Maximized = true;
        }
        protected override void OnMove(EventArgs args) { base.OnMove(args); TrackGeometry(); }
        protected override void OnResize(EventArgs args) { base.OnResize(args); TrackGeometry(); }
        [StructLayout(LayoutKind.Sequential)]
        private struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }
        protected override void WndProc(ref Message message)
        {
            if (message.Msg == 0x02E0 && message.LParam != IntPtr.Zero)
            {
                NativeRect suggested = (NativeRect)Marshal.PtrToStructure(message.LParam, typeof(NativeRect));
                adjustingDpi = true;
                base.WndProc(ref message);
                if (WindowState == FormWindowState.Normal)
                    SetBounds(suggested.Left, suggested.Top, suggested.Right - suggested.Left, suggested.Bottom - suggested.Top);
                adjustingDpi = false; TrackGeometry();
                return;
            }
            base.WndProc(ref message);
        }
        protected override void OnFormClosing(FormClosingEventArgs args)
        {
            TrackGeometry();
            stopping = true; deadlines.Stop(); pending.Clear(); latestModel = null;
            try { GeometryStore.Save(options.StateData, geometry); }
            catch (Exception error) { Program.Diagnostic("geometry-save-failed", error); }
            base.OnFormClosing(args);
            args.Cancel = false;
        }
        protected override void OnFormClosed(FormClosedEventArgs args)
        {
            stopping = true;
            deadlines.Dispose();
            browser.Dispose();
            try { output.Send("{\"op\":\"closed\",\"bounds\":" + geometry.BoundsJson + "}"); }
            catch (IOException) { }
            base.OnFormClosed(args);
        }
    }
}
