using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Windows.Forms;

namespace WorkspaceNavigator
{
    internal static class NativeTests
    {
        private static int passed;
        private static void Check(bool condition, string name)
        {
            if (!condition) throw new Exception("Assertion failed: " + name);
            passed++;
        }
        private static void Reject(Action action, string name)
        {
            bool rejected = false;
            try { action(); }
            catch (ProtocolException) { rejected = true; }
            Check(rejected, name);
        }
        private static BoundedLineReader Reader(byte[] bytes)
        { return new BoundedLineReader(new SmallChunkStream(bytes)); }
        private static BoundedLineReader Reader(string text) { return Reader(WireProtocol.Utf8.GetBytes(text)); }
        private static void Transport()
        {
            WireMessage ready = WireProtocol.Parse("{\"op\":\"ready\",\"id\":\"n1\"}", false);
            Check(ready.Op == "ready" && ready.Id == "n1", "ready string correlation id");
            Check(WireProtocol.Parse("{\"op\":\"focus\"}", true).Op == "focus", "focus");
            Check(WireProtocol.Parse("{\"op\":\"close\"}", true).Op == "close", "close");
            string model = "{\"op\":\"model\",\"model\":{\"label\":\"<svg>汉字😀\",\"a\":[null,true,false,-0,1.5e+2]}}";
            WireMessage incoming = WireProtocol.Parse(model, true);
            Check(incoming.Value.Raw == model.Substring(22, model.Length - 23), "exact model JSON preservation");
            Check(WireProtocol.Parse("{\"op\":\"result\",\"id\":\"n2\",\"value\":null}", true).Value.Kind == JsonKind.Null, "null rendered reply");
            Check(WireProtocol.Parse(WireProtocol.Failure("n3", "unavailable"), true).Id == "n3", "error sentinel within result");
            Check(WireProtocol.Parse("{\"op\":\"command\",\"id\":\"n4\",\"value\":{\"type\":\"return\"}}", false).Op == "command", "opaque business intent");
            Check(WireProtocol.Parse("{\"op\":\"rendered\",\"id\":\"n5\",\"value\":{\"instance\":\"i\",\"revision\":1}}", false).Op == "rendered", "actual renderer ack");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"ExecuteScript\",\"code\":\"x\"}", true); }, "no execute command");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"model\",\"model\":{},\"url\":\"https://evil.invalid\"}", true); }, "no URL surface");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"ready\",\"id\":1}", false); }, "id must be string");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"ready\",\"id\":\"n\\n1\"}", false); }, "id cannot inject framing");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"ready\",\"id\":\"" + new string('a', 129) + "\"}", false); }, "id bound");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"ready\",\"id\":\"n1\",\"value\":null}", false); }, "exact request fields");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"command\",\"id\":\"n1\",\"value\":[]}", false); }, "command object only");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"model\",\"model\":null}", true); }, "model object only");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"result\",\"id\":\"n1\"}", true); }, "missing result rejects");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"ready\",\"op\":\"command\",\"id\":\"n1\"}", false); }, "duplicate root key");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"model\",\"model\":{\"a\":1,\"\\u0061\":2}}", true); }, "duplicate nested decoded key");
            string[] badValues = new string[] { "NaN", "Infinity", "01", "1.", "1e", "+1", "undefined", "{\"x\":1,}", "[1,]", "'x'", "\"\\z\"" };
            foreach (string bad in badValues)
                Reject(delegate { WireProtocol.Parse("{\"op\":\"result\",\"id\":\"n1\",\"value\":" + bad + "}", true); }, "strict JSON " + bad);
            Reject(delegate { StrictJson.Object("{\"x\":1}{}"); }, "trailing JSON rejects");
            string deep = new string('[', 66) + "0" + new string(']', 66);
            Reject(delegate { StrictJson.Object("{\"x\":" + deep + "}"); }, "depth budget");
            string atLimit = "{\"x\":\"" + new string('a', WireProtocol.MaxInnerBytes - 8) + "\"}";
            Check(WireProtocol.Utf8.GetByteCount(atLimit) == WireProtocol.MaxInnerBytes, "inner exact budget fixture");
            Check(WireProtocol.Parse("{\"op\":\"model\",\"model\":" + atLimit + "}", true).Op == "model", "4 MiB inclusive");
            Reject(delegate { WireProtocol.Parse("{\"op\":\"model\",\"model\":" + atLimit.Replace("\"}", "a\"}") + "}", true); }, "inner budget overflow");
            string unicodeOverflow = "{\"op\":\"result\",\"id\":\"n1\",\"value\":\"" + new string('汉', WireProtocol.MaxInnerBytes / 3) + "\"}";
            Reject(delegate { WireProtocol.Parse(unicodeOverflow, true); }, "budget counts UTF8 bytes not UTF16 chars");
            Reject(delegate { WireProtocol.Parse(new string(' ', WireProtocol.MaxCarrierBytes + 1), true); }, "carrier overflow");
            string quoted = WireProtocol.Quote("x\n\r\t\"\\<>&汉😀");
            Check(StrictJson.Object("{\"x\":" + quoted + "}")["x"].Text == "x\n\r\t\"\\<>&汉😀", "safe JSON quote roundtrip");
            string compact = WireProtocol.Compact(" { \"x\" : \" a \\\" b \\n \" , \"v\": [ 1, 2 ] } \r\n");
            Check(compact == "{\"x\":\" a \\\" b \\n \",\"v\":[1,2]}", "compact structural whitespace only");
            BoundedLineReader lines = Reader("{\"op\":\"focus\"}\r\n{\"op\":\"close\"}\n");
            Check(lines.ReadLine() == "{\"op\":\"focus\"}" && lines.ReadLine() == "{\"op\":\"close\"}" && lines.ReadLine() == null, "fragmented CRLF lines and EOF");
            Check(Reader("汉😀\n").ReadLine() == "汉😀", "UTF8 split across chunk boundaries");
            Reject(delegate { Reader("{} without newline").ReadLine(); }, "truncated EOF rejects");
            Reject(delegate { Reader("\n").ReadLine(); }, "empty frame rejects");
            Reject(delegate { Reader(new byte[] { 0xC0, 0x80, 10 }).ReadLine(); }, "invalid UTF8 rejects");
            Reject(delegate { Reader(new string('a', WireProtocol.MaxCarrierBytes + 1) + "\n").ReadLine(); }, "bounded no-newline buffering");
            Check(Reader(new string('a', WireProtocol.MaxCarrierBytes) + "\n").ReadLine().Length == WireProtocol.MaxCarrierBytes, "carrier exact line budget");
            MemoryStream bytes = new MemoryStream();
            new WireOutput(bytes).Send("{\"op\":\"started\"}");
            Check(WireProtocol.Utf8.GetString(bytes.ToArray()) == "{\"op\":\"started\"}\n", "stdout has one LF and no BOM");
        }
        private static void Assets()
        {
            Check(AssetPolicy.Allowed(AssetPolicy.InitialUrl, "GET"), "fixed initial document");
            Check(AssetPolicy.Allowed("https://navigator.local/workspace-navigator.js", "GET"), "fixed script");
            Check(AssetPolicy.Allowed("https://navigator.local/workspace-navigator.css", "GET"), "fixed style");
            foreach (string denied in new string[] { "https://example.invalid/", "file:///C:/secret", "http://navigator.local/workspace-navigator.html",
                "https://navigator.local/secret.json", "https://navigator.local/workspace-navigator.html?x", "https://navigator.local/workspace-navigator.html#x",
                "https://navigator.local:444/workspace-navigator.html", "https://user@navigator.local/workspace-navigator.html", "https://navigator.local/../secret",
                "https://navigator.local/%2e%2e/secret", "data:text/html,x", "javascript:alert(1)", "https://navigator.local.evil.invalid/workspace-navigator.js" })
                Check(!AssetPolicy.Allowed(denied, "GET"), "deny resource " + denied);
            Check(!AssetPolicy.Allowed(AssetPolicy.InitialUrl, "POST"), "GET only");
            Check(!AssetPolicy.Allowed(AssetPolicy.InitialUrl, "PUT"), "no resource writes");
        }
        private static Options Admit(string assets, string userData, string stateData)
        { return Options.Parse(new string[] { "--assets", assets, "--user-data", userData, "--state-data", stateData }); }
        private static void Arguments(string assets, string userData, string stateData)
        {
            string[] flags = new string[] { "--assets", "--user-data", "--state-data" };
            string[] roots = new string[] { assets, userData, stateData };
            foreach (int[] order in new int[][] { new int[] { 0, 1, 2 }, new int[] { 0, 2, 1 },
                new int[] { 1, 0, 2 }, new int[] { 1, 2, 0 }, new int[] { 2, 0, 1 }, new int[] { 2, 1, 0 } })
            {
                List<string> args = new List<string>();
                foreach (int item in order) { args.Add(flags[item]); args.Add(roots[item]); }
                Options value = Options.Parse(args.ToArray());
                Check(value.Mode == "window" && value.Assets == assets && value.UserData == userData && value.StateData == stateData,
                    "strict three-pair CLI accepts order " + String.Join(",", order));
            }
            foreach (string[] invalid in new string[][] {
                new string[0], new string[] { "--assets" },
                new string[] { "--assets", assets, "--user-data", userData },
                new string[] { "--assets", assets, "--state-data", stateData },
                new string[] { "--user-data", userData, "--state-data", stateData },
                new string[] { "--assets", assets, "--user-data", userData, "--state-data" },
                new string[] { "--assets", assets, "--user-data", userData, "--state-data", stateData, "extra" },
                new string[] { "--assets", assets, "--assets", assets, "--state-data", stateData },
                new string[] { "--assets", assets, "--user-data", userData, "--user-data", userData },
                new string[] { "--state-data", stateData, "--state-data", stateData, "--assets", assets },
                new string[] { "--assets", assets, "--user-data", userData, "--unknown", stateData },
                new string[] { "--Assets", assets, "--user-data", userData, "--state-data", stateData },
                new string[] { "--probe", assets, "--user-data", userData, "--state-data", stateData },
                new string[] { "--version", assets, "--user-data", userData, "--state-data", stateData },
                new string[] { "--probe", "--assets", assets, "--user-data", userData, "--state-data", stateData },
                new string[] { "--version", "--assets", assets, "--user-data", userData, "--state-data", stateData }
            }) Reject(delegate { Options.Parse(invalid); }, "strict CLI rejects missing/duplicate/unknown/mixed or legacy arguments " + String.Join(" ", invalid));
            foreach (string mode in new string[] { "--probe", "--version" })
            {
                Options headless = Options.Parse(new string[] { mode });
                Check(headless.Mode == mode && headless.Assets == null && headless.UserData == null && headless.StateData == null,
                    "exclusive headless mode has no authorized filesystem roots " + mode);
                Reject(delegate { headless.CreateDataDirectories(); }, "headless mode cannot create directories " + mode);
            }
        }
        private static void FixedAssets(string directory)
        {
            Directory.CreateDirectory(directory);
            foreach (string extension in new string[] { ".html", ".js", ".css" })
                File.WriteAllText(Path.Combine(directory, "workspace-navigator" + extension), "owned headless fixture");
        }
        private static void Junction(string fixture, string link, string target)
        {
            // No recursive cleanup: links and their new, owned targets are retained under bin/.
            fixture = Path.GetFullPath(fixture);
            link = Path.GetFullPath(link); target = Path.GetFullPath(target);
            if (!SafePaths.Within(link, fixture) || !SafePaths.Within(target, fixture)
                || link == fixture || target == fixture || !Directory.Exists(target)
                || Directory.Exists(link) || File.Exists(link)) throw new Exception("Unowned junction fixture");
            ProcessStartInfo start = new ProcessStartInfo("cmd.exe", "/d /c mklink /J \"" + link + "\" \"" + target + "\"");
            start.UseShellExecute = false; start.CreateNoWindow = true;
            start.RedirectStandardOutput = true; start.RedirectStandardError = true;
            using (Process process = Process.Start(start))
            {
                string stdout = process.StandardOutput.ReadToEnd();
                string stderr = process.StandardError.ReadToEnd();
                process.WaitForExit();
                Console.WriteLine("{\"op\":\"fixture-command\",\"command\":" + WireProtocol.Quote(start.FileName + " " + start.Arguments)
                    + ",\"exitCode\":" + process.ExitCode + ",\"guiLaunched\":false}");
                if (process.ExitCode != 0) throw new Exception("Junction fixture failed: " + stdout + stderr);
            }
            Check((File.GetAttributes(link) & FileAttributes.ReparsePoint) != 0, "new fixture is an actual Windows junction");
        }
        private static void Paths()
        {
            string fixture = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "paths-" + Guid.NewGuid().ToString("N"));
            string package = Path.Combine(fixture, "package");
            string assets = Path.Combine(package, "renderer");
            string profile = Path.Combine(fixture, "profile");
            string directData = Path.Combine(profile, "direct-data");
            string directState = Path.Combine(profile, "direct-state");
            FixedAssets(assets); Directory.CreateDirectory(directData); Directory.CreateDirectory(directState);
            Arguments(assets, directData, directState);
            Options direct = Admit(assets, directData, directState);
            Check(direct.Assets == assets && direct.UserData == directData && direct.StateData == directState,
                "direct local assets, browser and profile state roots admitted");
            string packageAlias = Path.Combine(fixture, "package-junction");
            string assetsAlias = Path.Combine(fixture, "assets-junction");
            string profileAlias = Path.Combine(fixture, "profile-junction");
            Junction(fixture, packageAlias, package); Junction(fixture, assetsAlias, assets);
            Junction(fixture, profileAlias, profile);
            Options linkedAssets = Admit(Path.Combine(packageAlias, "renderer"), directData, directState);
            Check(linkedAssets.Assets == assets, "junction ancestor of package assets canonicalized");
            Check(Admit(assetsAlias, directData, directState).Assets == assets, "junction asset root canonicalized");
            Check(Admit(assets, Path.Combine(profileAlias, "direct-data"), directState).UserData == directData,
                "junction ancestor of existing profile user-data canonicalized");
            Check(Admit(assets, directData, Path.Combine(profileAlias, "direct-state")).StateData == directState,
                "junction ancestor of existing profile state-data canonicalized");
            string dataAlias = Path.Combine(fixture, "data-junction");
            string stateAlias = Path.Combine(fixture, "state-junction");
            Junction(fixture, dataAlias, directData); Junction(fixture, stateAlias, directState);
            Check(Admit(assets, dataAlias, directState).UserData == directData, "junction user-data root canonicalized");
            Check(Admit(assets, directData, stateAlias).StateData == directState, "junction state-data root canonicalized");
            Options allLinked = Admit(assetsAlias, dataAlias, stateAlias);
            Check(allLinked.Assets == assets && allLinked.UserData == directData && allLinked.StateData == directState,
                "three distinct legitimate junction roots admitted together");
            string missing = Path.Combine(profile, "new-data", "client");
            string missingState = Path.Combine(profile, "new-state", "window-state");
            Options both = Admit(Path.Combine(packageAlias, "renderer"), Path.Combine(profileAlias, "new-data", "client"),
                Path.Combine(profileAlias, "new-state", "window-state"));
            Check(both.Assets == assets && both.UserData == missing && both.StateData == missingState
                && !Directory.Exists(missing) && !Directory.Exists(missingState),
                "all junction roots admitted and both missing data tails resolve without creation");
            both.CreateDataDirectories();
            Check(both.UserData == missing && both.StateData == missingState && Directory.Exists(missing) && Directory.Exists(missingState),
                "window startup creates browser and state roots");
            Check(both.Assets == SafePaths.LocalDirectory(assets, true) && both.UserData == SafePaths.LocalDirectory(missing, true)
                && both.StateData == SafePaths.LocalDirectory(missingState, true), "all three roots remain canonical after creation");
            Check(Directory.GetFiles(assets).Length == 3 && Directory.GetDirectories(assets).Length == 0,
                "data creation does not write assets or inferred siblings");
            GeometryState state = new GeometryState(new Rectangle(100, 80, 800, 600), false);
            string linkedState = Path.Combine(profileAlias, "new-state", "window-state");
            GeometryStore.Save(linkedState, state);
            Check(GeometryStore.Load(linkedState, new Rectangle[] { new Rectangle(0, 0, 1920, 1040) }).NormalBounds == state.NormalBounds,
                "owned geometry reads and writes under admitted state junction directory");
            GeometryStore.Save(linkedState, new GeometryState(state.NormalBounds, true));
            Check(GeometryStore.Load(linkedState, new Rectangle[] { new Rectangle(0, 0, 1920, 1040) }).Maximized,
                "owned atomic geometry replacement under state junction retains state");
            Reject(delegate { Admit(assetsAlias, assets, directState); }, "aliased identical assets and user roots reject");
            Reject(delegate { Admit(assetsAlias, directData, assets); }, "aliased identical assets and state roots reject");
            Reject(delegate { Admit(assets, dataAlias, directData); }, "aliased identical user and state roots reject");
            Reject(delegate { Admit(assets, Path.Combine(assetsAlias, "private", "new-tail"), directState); }, "aliased user descendant of assets rejects");
            Reject(delegate { Admit(Path.Combine(packageAlias, "renderer"), package, directState); }, "assets descendant of aliased user root rejects");
            Reject(delegate { Admit(assetsAlias, packageAlias, directState); }, "both aliased overlapping assets and user roots reject");
            Reject(delegate { Admit(assets, directData, Path.Combine(assetsAlias, "private", "new-tail")); }, "aliased state descendant of assets rejects");
            Reject(delegate { Admit(assetsAlias, directData, packageAlias); }, "assets descendant of aliased state root rejects");
            Reject(delegate { Admit(assets, directData, Path.Combine(dataAlias, "state", "new-tail")); }, "aliased state descendant of user root rejects");
            Reject(delegate { Admit(assets, Path.Combine(stateAlias, "client", "new-tail"), directState); }, "aliased user descendant of state root rejects");
            string neighbor = Path.Combine(package, "renderer-neighbor");
            Check(Admit(assetsAlias, Path.Combine(packageAlias, "renderer-neighbor"), directState).UserData == neighbor,
                "canonical neighboring same-prefix roots are not mistaken for overlap");
            Check(Admit(assets, Path.Combine(profileAlias, "sibling-data"), Path.Combine(profileAlias, "sibling-state")).StateData
                == Path.Combine(profile, "sibling-state"), "distinct sibling data roots under trusted profile junction remain valid");
            Check(Admit(assets, directData, Path.Combine(profileAlias, "direct-data-state")).StateData == Path.Combine(profile, "direct-data-state"),
                "same-prefix browser and state sibling roots remain valid");
            Reject(delegate { Admit(Path.Combine(fixture, "missing-assets"), directData, directState); }, "missing asset root rejects");
            Reject(delegate { Admit(Path.Combine(assets, "workspace-navigator.html"), directData, directState); }, "file cannot be a trusted directory root");
            Reject(delegate { Admit(assets, Path.Combine(assets, "workspace-navigator.html", "child"), directState); }, "user tail cannot descend through a file");
            Reject(delegate { Admit(assets, directData, Path.Combine(assets, "workspace-navigator.html", "child")); }, "state tail cannot descend through a file");
            foreach (string unsafeState in new string[] { "relative/path", "\\\\server\\share\\state", "\\\\?\\" + directState,
                "\\\\.\\C:\\state", Path.GetPathRoot(profile), directState + ":stream", Path.Combine(profile, "ambiguous. "),
                Path.Combine(profile, "NUL.txt"), Path.Combine(profile, "bad*tail"), Path.Combine(assets, "workspace-navigator.html") })
                Reject(delegate { Admit(assets, directData, unsafeState); }, "state-data local/root/device/file admission rejects " + unsafeState);
            Reject(delegate { SafePaths.LocalDirectory("\\\\?\\" + assets, false); }, "caller device namespace rejects");
            Reject(delegate { SafePaths.LocalDirectory(assets + ":stream", false); }, "alternate data stream directory rejects");
            Reject(delegate { SafePaths.LocalDirectory(Path.Combine(profile, "ambiguous. "), false); }, "ambiguous missing tail rejects");
            Reject(delegate { SafePaths.LocalDirectory(Path.Combine(profile, "NUL.txt"), false); }, "DOS device missing tail rejects");
            Reject(delegate { SafePaths.LocalDirectory(Path.Combine(profile, "bad*tail"), false); }, "invalid missing tail rejects");
            string blocked = Path.Combine(profile, "blocked-geometry");
            string target = Path.Combine(profile, "geometry-target");
            Directory.CreateDirectory(blocked); Directory.CreateDirectory(target);
            Junction(fixture, Path.Combine(blocked, GeometryStore.Filename), target);
            Reject(delegate { GeometryStore.Save(blocked, state); }, "owned geometry leaf reparse remains denied");
            Check(!File.Exists(Path.Combine(target, GeometryStore.Filename)), "geometry leaf denial did not write junction target");
            string badAssets = Path.Combine(package, "bad-resources");
            Directory.CreateDirectory(badAssets);
            File.WriteAllText(Path.Combine(badAssets, "workspace-navigator.js"), "fixture");
            File.WriteAllText(Path.Combine(badAssets, "workspace-navigator.css"), "fixture");
            Junction(fixture, Path.Combine(badAssets, "workspace-navigator.html"), target);
            Reject(delegate { Admit(badAssets, directData, directState); }, "fixed resource leaf cannot be a directory junction");
            // Ancestors materialized after Parse must be re-admitted before either directory is created.
            string late = Path.Combine(profile, "late");
            Options pending = Admit(assetsAlias, late, directState);
            Junction(fixture, late, assets);
            Reject(delegate { pending.CreateDataDirectories(); }, "startup recanonicalization catches late user alias to assets");
            string lateState = Path.Combine(profile, "late-state");
            string untouchedUser = Path.Combine(profile, "not-created-user");
            Options pendingState = Admit(assets, untouchedUser, lateState);
            Junction(fixture, lateState, assets);
            Reject(delegate { pendingState.CreateDataDirectories(); }, "startup rejects late state alias to assets before creation");
            Check(!Directory.Exists(untouchedUser), "unsafe state re-admission occurs before creating browser directory");
            string lateUserOverlap = Path.Combine(profile, "late-user-overlap");
            Options pendingUserOverlap = Admit(assets, lateUserOverlap, directState);
            Junction(fixture, lateUserOverlap, directState);
            Reject(delegate { pendingUserOverlap.CreateDataDirectories(); }, "startup rejects late user alias to state");
            string lateStateOverlap = Path.Combine(profile, "late-state-overlap");
            Options pendingStateOverlap = Admit(assets, directData, lateStateOverlap);
            Junction(fixture, lateStateOverlap, directData);
            Reject(delegate { pendingStateOverlap.CreateDataDirectories(); }, "startup rejects late state alias to user");
            StableState(assets, fixture);
            Console.WriteLine("{\"op\":\"path-fixtures\",\"root\":" + WireProtocol.Quote(fixture)
                + ",\"cleanup\":\"retained-no-deletion\",\"guiLaunched\":false}");
        }
        private static void StableState(string assets, string fixture)
        {
            string profile = Path.Combine(fixture, "persistence-profile");
            string userA = Path.Combine(profile, Guid.NewGuid().ToString("N"));
            string userB = Path.Combine(profile, Guid.NewGuid().ToString("N"));
            string stableState = Path.Combine(profile, "window-state");
            Options clientA = Admit(assets, userA, stableState);
            Check(!Directory.Exists(userA) && !Directory.Exists(userB) && !Directory.Exists(stableState),
                "parsing three explicit roots creates no browser or state directories");
            clientA.CreateDataDirectories();
            Check(Directory.Exists(userA) && Directory.Exists(stableState) && !Directory.Exists(userB),
                "first client creates only its browser root and stable state root");
            Rectangle[] areas = new Rectangle[] { new Rectangle(0, 0, 1920, 1040) };
            GeometryState oldBrowserState = new GeometryState(new Rectangle(80, 60, 500, 400), true);
            string oldGeometry = Path.Combine(clientA.UserData, GeometryStore.Filename);
            File.WriteAllText(oldGeometry, oldBrowserState.Json);
            string browserSentinel = Path.Combine(clientA.UserData, "browser-cache-sentinel.txt");
            File.WriteAllText(browserSentinel, "client A browser cache must not be copied or deleted");
            GeometryState emptyState = GeometryStore.Load(clientA.StateData, areas);
            Check(emptyState.NormalBounds != oldBrowserState.NormalBounds && !emptyState.Maximized,
                "legacy GUID browser geometry is not a source when profile state is missing");
            GeometryState chosen = new GeometryState(new Rectangle(240, 130, 1000, 760), true);
            GeometryStore.Save(clientA.StateData, chosen);
            Options clientB = Admit(assets, userB, stableState);
            clientB.CreateDataDirectories();
            Check(clientA.UserData != clientB.UserData && clientA.StateData == clientB.StateData,
                "new Main client changes browser identity but keeps explicit profile geometry owner");
            GeometryState reopened = GeometryStore.Load(clientB.StateData, areas);
            Check(reopened.NormalBounds == chosen.NormalBounds && reopened.Maximized,
                "fresh Main client restores saved normal outer bounds and maximized flag through stable state");
            Check(!File.Exists(Path.Combine(clientB.UserData, GeometryStore.Filename))
                && !File.Exists(Path.Combine(clientB.UserData, "browser-cache-sentinel.txt")),
                "new browser root never imports old browser cache or geometry");
            Check(File.ReadAllText(oldGeometry) == oldBrowserState.Json && File.Exists(browserSentinel),
                "old browser geometry and cache remain untouched without migration or deletion");
            GeometryState later = new GeometryState(new Rectangle(300, 160, 900, 700), false);
            GeometryStore.Save(clientB.StateData, later);
            GeometryState observedByA = GeometryStore.Load(clientA.StateData, areas);
            Check(observedByA.NormalBounds == later.NormalBounds && !observedByA.Maximized,
                "profile geometry is last successful atomic writer, independent of browser client");
            Check(Directory.GetFiles(stableState).Length == 1 && Directory.GetDirectories(stableState).Length == 0,
                "state root contains only the owned atomic geometry object");
            Check(Directory.Exists(userA) && Directory.Exists(userB) && Directory.Exists(stableState) && File.Exists(oldGeometry)
                && File.Exists(browserSentinel), "all client and state directories and old files retained without cleanup");
        }
        private static void Geometry()
        {
            Rectangle[] displays = new Rectangle[] { new Rectangle(0, 0, 1920, 1040), new Rectangle(-1280, 0, 1280, 984) };
            GeometryState saved = new GeometryState(new Rectangle(220, 110, 1044, 788), false);
            GeometryState first = GeometryStore.Normalize(saved, displays);
            for (int i = 0; i < 20; i++) first = GeometryStore.Normalize(GeometryStore.Parse(first.Json), displays);
            Check(first.NormalBounds == saved.NormalBounds, "normal outer frame has no content/frame drift over reopen");
            GeometryState removedMonitor = GeometryStore.Normalize(new GeometryState(new Rectangle(9000, -9000, 3000, 2000), true), displays);
            Check(displays[0].Contains(removedMonitor.NormalBounds) || displays[1].Contains(removedMonitor.NormalBounds), "removed monitor is clamped visible");
            Check(removedMonitor.Maximized, "maximize state independent of normal frame");
            GeometryState left = GeometryStore.Normalize(new GeometryState(new Rectangle(-1200, 40, 800, 700), false), displays);
            Check(left.NormalBounds.X == -1200, "negative monitor coordinates retained");
            GeometryState tiny = GeometryStore.Normalize(saved, new Rectangle[] { new Rectangle(10, 20, 280, 200) });
            Check(tiny.NormalBounds == new Rectangle(10, 20, 280, 200), "small work area is respected");
            Reject(delegate { GeometryStore.Parse("{\"version\":1,\"bounds\":{\"x\":0,\"y\":0,\"width\":-1,\"height\":500},\"maximized\":false}"); }, "negative geometry rejects");
            Reject(delegate { GeometryStore.Parse("{\"version\":2,\"bounds\":{},\"maximized\":false}"); }, "unknown geometry version");
            string fixture = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "geometry-fixture-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(fixture);
            GeometryStore.Save(fixture, saved);
            Check(GeometryStore.Load(fixture, displays).NormalBounds == saved.NormalBounds, "persist scoped normal outer geometry");
            GeometryState changed = new GeometryState(new Rectangle(240, 130, 1000, 760), true);
            GeometryStore.Save(fixture, changed);
            GeometryState loaded = GeometryStore.Load(fixture, displays);
            Check(loaded.NormalBounds == changed.NormalBounds && loaded.Maximized, "atomic owned geometry replacement");
            string path = Path.Combine(fixture, GeometryStore.Filename);
            File.WriteAllText(path, new string('x', 8192));
            Check(!GeometryStore.Load(fixture, displays).Maximized, "oversize owned geometry is bounded and ignored");
            File.WriteAllText(path, "{invalid");
            Check(!GeometryStore.Load(fixture, displays).Maximized, "malformed owned geometry recovers to defaults");
            GeometryStore.Save(fixture, changed);
            Check(SafePaths.Within(Path.Combine(fixture, "child"), fixture), "within boundary");
            Check(!SafePaths.Within(fixture + "-elsewhere", fixture), "sibling prefix not contained");
            Reject(delegate { SafePaths.LocalDirectory("relative/path", false); }, "absolute local paths only");
            Reject(delegate { SafePaths.LocalDirectory("\\\\server\\share", false); }, "UNC source rejects");
            Reject(delegate { SafePaths.LocalDirectory("C:\\", false); }, "volume root rejects");
        }
        private static void FocusGeometry()
        {
            Rectangle primary = new Rectangle(0, 0, 1920, 1040);
            Rectangle secondary = new Rectangle(-1280, 0, 1280, 984);
            Rectangle[] afterRemoval = new Rectangle[] { primary };
            Rectangle[] bothDisplays = new Rectangle[] { primary, secondary };
            Rectangle offscreen = new Rectangle(-1200, 80, 800, 700);
            Rectangle valid = new Rectangle(240, 130, 1000, 760);
            Rectangle minimized = new Rectangle(-32000, -32000, 160, 28);
            GeometryState tracked = new GeometryState(offscreen, false);
            GeometryState recovered = GeometryStore.ForFocus(tracked, offscreen, valid, FormWindowState.Normal, afterRemoval);
            Check(primary.Contains(recovered.NormalBounds) && recovered.NormalBounds.Size == offscreen.Size && !recovered.Maximized,
                "Locate normal window after monitor removal uses current work area and preserves outer size");
            Check(tracked.NormalBounds == offscreen && !tracked.Maximized, "focus planning does not mutate tracked geometry");
            GeometryState live = GeometryStore.ForFocus(new GeometryState(offscreen, true), valid, offscreen, FormWindowState.Normal, afterRemoval);
            Check(live.NormalBounds == valid && !live.Maximized, "Locate preserves valid live normal placement instead of stale tracked state");
            Check(GeometryStore.ForFocus(tracked, offscreen, valid, FormWindowState.Normal, bothDisplays).NormalBounds == offscreen,
                "Locate leaves valid negative-coordinate secondary placement intact");
            GeometryState maximized = GeometryStore.ForFocus(tracked, primary, offscreen, FormWindowState.Maximized, afterRemoval);
            Check(primary.Contains(maximized.NormalBounds) && maximized.NormalBounds.Size == offscreen.Size && maximized.Maximized,
                "Locate maximized recovery uses normal restore outer size and remains maximized");
            GeometryState validMaximized = GeometryStore.ForFocus(tracked, primary, valid, FormWindowState.Maximized, afterRemoval);
            Check(validMaximized.NormalBounds == valid && validMaximized.Maximized,
                "Locate preserves valid maximized restore placement independent of maximized frame dimensions");
            GeometryState unminimized = GeometryStore.ForFocus(tracked, minimized, offscreen, FormWindowState.Minimized, afterRemoval);
            Check(primary.Contains(unminimized.NormalBounds) && unminimized.NormalBounds.Size == offscreen.Size && !unminimized.Maximized,
                "Locate minimized normal recovery ignores minimized frame and restores normal state");
            GeometryState minFromMax = GeometryStore.ForFocus(new GeometryState(offscreen, true), minimized, offscreen,
                FormWindowState.Minimized, afterRemoval);
            Check(primary.Contains(minFromMax.NormalBounds) && minFromMax.NormalBounds.Size == offscreen.Size && minFromMax.Maximized,
                "Locate minimized-from-maximized recovery retains maximized intent and normal outer size");
            Check(GeometryStore.ForFocus(tracked, minimized, valid, FormWindowState.Minimized, afterRemoval).NormalBounds == valid,
                "Locate minimized valid restore placement is not moved");
            GeometryState minValidMax = GeometryStore.ForFocus(new GeometryState(offscreen, true), minimized, valid,
                FormWindowState.Minimized, afterRemoval);
            Check(minValidMax.NormalBounds == valid && minValidMax.Maximized, "Locate minimized-from-maximized valid placement preserved");
            GeometryState oversized = GeometryStore.ForFocus(tracked, primary, new Rectangle(-4000, 20, 3000, 1800),
                FormWindowState.Maximized, afterRemoval);
            Check(oversized.NormalBounds == primary && oversized.Maximized, "Locate reuses geometry owner's work-area sizing for oversized restore frame");
        }
        public static int Main()
        {
            try
            {
                Transport(); Assets(); Geometry(); Paths(); FocusGeometry();
                Console.WriteLine("{\"op\":\"native-tests\",\"passed\":" + passed + ",\"guiLaunched\":false}");
                return 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        }
        private sealed class SmallChunkStream : MemoryStream
        {
            internal SmallChunkStream(byte[] bytes) : base(bytes, false) { }
            public override int Read(byte[] buffer, int offset, int count) { return base.Read(buffer, offset, Math.Min(count, 3)); }
        }
    }
}
