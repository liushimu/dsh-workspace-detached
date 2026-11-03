using System;
using System.Collections;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;

[assembly: AssemblyTitle("Workspace Navigator")]
[assembly: AssemblyDescription("Independent fixed-asset WinForms/WebView2 display carrier")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace WorkspaceNavigator
{
    internal sealed class Options
    {
        internal string Assets;
        internal string UserData;
        internal string StateData;
        internal string Mode;
        internal static Options Parse(string[] args)
        {
            Options value = new Options();
            if (args.Length == 1 && (args[0] == "--probe" || args[0] == "--version"))
            { value.Mode = args[0]; return value; }
            if (args.Length != 6) throw new ProtocolException("invalid-arguments");
            for (int i = 0; i < args.Length; i += 2)
            {
                if (args[i] == "--assets" && value.Assets == null) value.Assets = args[i + 1];
                else if (args[i] == "--user-data" && value.UserData == null) value.UserData = args[i + 1];
                else if (args[i] == "--state-data" && value.StateData == null) value.StateData = args[i + 1];
                else throw new ProtocolException("invalid-arguments");
            }
            value.AdmitRoots(false);
            foreach (string name in new string[] { "workspace-navigator.html", "workspace-navigator.js", "workspace-navigator.css" })
            {
                string path = Path.Combine(value.Assets, name);
                if (!File.Exists(path)) throw new ProtocolException("assets-unavailable");
                SafePaths.RejectReparseLeaf(path);
            }
            value.Mode = "window";
            return value;
        }
        private void AdmitRoots(bool dataMustExist)
        {
            Assets = SafePaths.LocalDirectory(Assets, true);
            UserData = SafePaths.LocalDirectory(UserData, dataMustExist);
            StateData = SafePaths.LocalDirectory(StateData, dataMustExist);
            // Every root is explicit Host authority. Never infer a profile parent from a client cache.
            // Compare canonical roots, including aliases of existing ancestors of a missing tail.
            if (SafePaths.Within(Assets, UserData) || SafePaths.Within(UserData, Assets)
                || SafePaths.Within(Assets, StateData) || SafePaths.Within(StateData, Assets)
                || SafePaths.Within(UserData, StateData) || SafePaths.Within(StateData, UserData))
                throw new ProtocolException("unsafe-path");
        }
        internal void CreateDataDirectories()
        {
            if (Mode != "window") throw new ProtocolException("invalid-arguments");
            AdmitRoots(false);
            Directory.CreateDirectory(UserData);
            Directory.CreateDirectory(StateData);
            AdmitRoots(true);
        }
    }

    internal static class Program
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool SetDllDirectory(string path);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr LoadLibraryEx(string filename, IntPtr reserved, uint flags);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("shcore.dll")]
        private static extern int SetProcessDpiAwareness(int awareness);
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        internal static void Diagnostic(string code, Exception error)
        {
            // Never write model content, labels, paths, user IDs, or stack traces to stdout/stderr.
            Console.Error.WriteLine("workspace-navigator: " + code + (error == null ? "" : " (" + error.GetType().Name + ")"));
        }
        private static Assembly ResolveLocalAssembly(object sender, ResolveEventArgs args)
        {
            string name = new AssemblyName(args.Name).Name;
            if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
            string path = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, name + ".dll");
            return File.Exists(path) ? Assembly.LoadFrom(path) : null;
        }
        private static void PrepareRuntime()
        {
            // Process-local only: inherited WebView overrides must not redirect this isolated profile,
            // add CDP/network ports, select another executable, or wait for an attached debugger.
            foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables())
            {
                string key = entry.Key as string;
                if (key != null && key.StartsWith("WEBVIEW2_", StringComparison.OrdinalIgnoreCase))
                    Environment.SetEnvironmentVariable(key, null, EnvironmentVariableTarget.Process);
            }
            if (!SetDllDirectory("")) throw new ProtocolException("loader-unavailable");
            string loader = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "WebView2Loader.dll");
            if (!File.Exists(loader) || LoadLibraryEx(loader, IntPtr.Zero, 0x100 | 0x800) == IntPtr.Zero)
                throw new ProtocolException("loader-unavailable");
        }
        private static void EnableDpi()
        {
            try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; }
            catch (EntryPointNotFoundException) { }
            try { SetProcessDpiAwareness(2); return; }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            SetProcessDPIAware();
        }
        [MethodImpl(MethodImplOptions.NoInlining)]
        private static string AvailableRuntime() { return CoreWebView2Environment.GetAvailableBrowserVersionString(null); }
        [MethodImpl(MethodImplOptions.NoInlining)]
        private static int RunWindow(Options options, WireOutput output)
        {
            options.CreateDataDirectories();
            EnableDpi();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            using (NavigatorForm form = new NavigatorForm(options, output))
            {
                Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs error)
                { form.Fail("carrier-failed", error.Exception); };
                Application.Run(form);
                return form.Failed ? 1 : 0;
            }
        }
        [STAThread]
        private static int Main(string[] args)
        {
            WireOutput output = new WireOutput(Console.OpenStandardOutput());
            AppDomain.CurrentDomain.AssemblyResolve += ResolveLocalAssembly;
            try
            {
                Options options = Options.Parse(args);
                if (!Environment.Is64BitProcess) throw new ProtocolException("unsupported-architecture");
                if (options.Mode == "--version")
                {
                    output.Send("{\"op\":\"version\",\"version\":\"1.0.0\",\"architecture\":\"win-x64\",\"transportVersion\":1}");
                    return 0;
                }
                PrepareRuntime();
                string runtime;
                try { runtime = AvailableRuntime(); }
                catch (Exception error)
                {
                    Diagnostic("runtime-unavailable", error);
                    output.Error("runtime-unavailable"); return 3;
                }
                if (String.IsNullOrEmpty(runtime)) throw new ProtocolException("runtime-unavailable");
                if (options.Mode == "--probe")
                {
                    output.Send("{\"op\":\"probe\",\"ok\":true,\"architecture\":\"win-x64\",\"runtimeVersion\":"
                        + WireProtocol.Quote(runtime) + ",\"transportVersion\":1,\"maxInnerBytes\":"
                        + WireProtocol.MaxInnerBytes + ",\"maxCarrierBytes\":" + WireProtocol.MaxCarrierBytes + "}");
                    return 0;
                }
                return RunWindow(options, output);
            }
            catch (ProtocolException error)
            {
                Diagnostic(error.Message, error);
                try { output.Error(error.Message); } catch (IOException) { }
                return 2;
            }
            catch (Exception error)
            {
                Diagnostic("carrier-failed", error);
                try { output.Error("carrier-failed"); } catch (IOException) { }
                return 1;
            }
        }
    }
}
