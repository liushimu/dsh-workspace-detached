using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

namespace WorkspaceNavigator
{
    internal sealed class GeometryState
    {
        internal Rectangle NormalBounds;
        internal bool Maximized;
        internal GeometryState(Rectangle bounds, bool maximized) { NormalBounds = bounds; Maximized = maximized; }
        internal string BoundsJson
        {
            get
            {
                return "{\"x\":" + NormalBounds.X.ToString(CultureInfo.InvariantCulture)
                    + ",\"y\":" + NormalBounds.Y.ToString(CultureInfo.InvariantCulture)
                    + ",\"width\":" + NormalBounds.Width.ToString(CultureInfo.InvariantCulture)
                    + ",\"height\":" + NormalBounds.Height.ToString(CultureInfo.InvariantCulture) + "}";
            }
        }
        internal string Json { get { return "{\"version\":1,\"bounds\":" + BoundsJson + ",\"maximized\":" + (Maximized ? "true" : "false") + "}"; } }
    }

    internal static class SafePaths
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string path, uint access, uint sharing,
            IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern uint GetDriveType(string root);

        private static string LocalFullPath(string input, bool allowRoot)
        {
            // Reject UNC/device namespaces, mapped remote drives, ADS and ambiguous missing-tail names.
            if (String.IsNullOrWhiteSpace(input) || input.Length < 3
                || !((input[0] >= 'A' && input[0] <= 'Z') || (input[0] >= 'a' && input[0] <= 'z'))
                || input[1] != ':' || (input[2] != '\\' && input[2] != '/'))
                throw new ProtocolException("invalid-arguments");
            foreach (string part in input.Substring(3).Split(new char[] { '\\', '/' }))
            {
                if (part.Length == 0 || part == "." || part == "..") continue;
                if (part.EndsWith(".", StringComparison.Ordinal) || part.EndsWith(" ", StringComparison.Ordinal)
                    || part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                    throw new ProtocolException("invalid-arguments");
                string device = part.Split('.')[0].ToUpperInvariant();
                if (device == "CON" || device == "PRN" || device == "AUX" || device == "NUL"
                    || (device.Length == 4 && (device.StartsWith("COM", StringComparison.Ordinal)
                        || device.StartsWith("LPT", StringComparison.Ordinal)) && device[3] >= '1' && device[3] <= '9'))
                    throw new ProtocolException("invalid-arguments");
            }
            string full;
            try { full = Path.GetFullPath(input).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar); }
            catch (ArgumentException) { throw new ProtocolException("invalid-arguments"); }
            catch (NotSupportedException) { throw new ProtocolException("invalid-arguments"); }
            catch (PathTooLongException) { throw new ProtocolException("invalid-arguments"); }
            if (full.Length == 2) full += Path.DirectorySeparatorChar;
            if (!allowRoot && full.Length <= 3) throw new ProtocolException("invalid-arguments");
            uint drive = GetDriveType(full.Substring(0, 3));
            if (drive == 0 || drive == 1 || drive == 4) throw new ProtocolException("unsafe-path");
            return full;
        }
        private static string ExistingDirectory(string path)
        {
            // Follow trusted directory junctions/symlinks. Framework has no ResolveLinkTarget;
            // the handle yields the final DOS path rather than a lexical alias of the same root.
            using (SafeFileHandle handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero))
            {
                if (handle.IsInvalid) throw new ProtocolException("unsafe-path");
                StringBuilder buffer = new StringBuilder(512);
                uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
                if (length >= buffer.Capacity && length < 32768)
                {
                    buffer = new StringBuilder((int)length + 1);
                    length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
                }
                if (length == 0 || length >= buffer.Capacity) throw new ProtocolException("unsafe-path");
                string final = buffer.ToString();
                if (final.StartsWith("\\\\?\\", StringComparison.Ordinal)) final = final.Substring(4);
                final = LocalFullPath(final, true); // Final UNC/remote/device targets are still inadmissible.
                if ((File.GetAttributes(final) & FileAttributes.Directory) == 0)
                    throw new ProtocolException("invalid-arguments");
                return final;
            }
        }
        internal static string LocalDirectory(string input, bool mustExist)
        {
            string full = LocalFullPath(input, false);
            List<string> tail = new List<string>();
            string cursor = full;
            try
            {
                while (true)
                {
                    FileAttributes attributes;
                    try { attributes = File.GetAttributes(cursor); }
                    catch (FileNotFoundException) { attributes = (FileAttributes)0; }
                    catch (DirectoryNotFoundException) { attributes = (FileAttributes)0; }
                    if (attributes != 0)
                    {
                        if ((attributes & FileAttributes.Directory) == 0) throw new ProtocolException("invalid-arguments");
                        break;
                    }
                    if (mustExist) throw new ProtocolException("assets-unavailable");
                    tail.Add(Path.GetFileName(cursor));
                    cursor = Path.GetDirectoryName(cursor);
                    if (String.IsNullOrEmpty(cursor)) throw new ProtocolException("unsafe-path");
                }
                string canonical = ExistingDirectory(cursor);
                for (int i = tail.Count - 1; i >= 0; i--) canonical = Path.Combine(canonical, tail[i]);
                if (canonical.Length <= 3) throw new ProtocolException("invalid-arguments");
                return canonical;
            }
            catch (IOException) { throw new ProtocolException("unsafe-path"); }
            catch (UnauthorizedAccessException) { throw new ProtocolException("unsafe-path"); }
        }
        internal static void RejectReparseLeaf(string path)
        {
            // Fixed resource/owned geometry leaf files must not redirect outside their admitted roots.
            // This is intentionally not the retired blanket directory-ancestor policy.
            try
            {
                if ((File.GetAttributes(path) & (FileAttributes.ReparsePoint | FileAttributes.Directory)) != 0)
                    throw new ProtocolException("unsafe-path");
            }
            catch (FileNotFoundException) { }
            catch (DirectoryNotFoundException) { }
        }
        internal static bool Within(string child, string parent)
        {
            return String.Equals(child, parent, StringComparison.OrdinalIgnoreCase)
                || child.StartsWith(parent + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }
    }

    internal static class GeometryStore
    {
        internal const string Filename = "window-bounds.json";
        internal static GeometryState Load(string stateData, Rectangle[] areas)
        {
            GeometryState state = null;
            string path = Path.Combine(stateData, Filename);
            try
            {
                SafePaths.RejectReparseLeaf(path);
                if (File.Exists(path))
                {
                    using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
                    {
                        byte[] bytes = new byte[4097];
                        int count = 0;
                        while (count < bytes.Length)
                        {
                            int read = stream.Read(bytes, count, bytes.Length - count);
                            if (read == 0) break;
                            count += read;
                        }
                        if (count <= 4096) state = Parse(WireProtocol.Utf8.GetString(bytes, 0, count));
                    }
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            catch (ProtocolException) { }
            catch (ArgumentException) { }
            return Normalize(state, areas);
        }
        internal static GeometryState Parse(string json)
        {
            Dictionary<string, JsonToken> values = StrictJson.Object(json);
            WireProtocol.Fields(values, "version", "bounds", "maximized");
            if (values["version"].Raw != "1" || values["bounds"].Kind != JsonKind.Object
                || values["maximized"].Kind != JsonKind.Boolean) throw new ProtocolException("invalid-geometry");
            Dictionary<string, JsonToken> bounds = StrictJson.Object(values["bounds"].Raw);
            WireProtocol.Fields(bounds, "x", "y", "width", "height");
            int x = Integer(bounds["x"], -100000, 100000);
            int y = Integer(bounds["y"], -100000, 100000);
            int width = Integer(bounds["width"], 160, 32000);
            int height = Integer(bounds["height"], 120, 32000);
            return new GeometryState(new Rectangle(x, y, width, height), values["maximized"].Raw == "true");
        }
        private static int Integer(JsonToken token, int min, int max)
        {
            int value;
            if (token.Kind != JsonKind.Number || !Int32.TryParse(token.Raw, NumberStyles.AllowLeadingSign,
                CultureInfo.InvariantCulture, out value) || value < min || value > max)
                throw new ProtocolException("invalid-geometry");
            return value;
        }
        internal static GeometryState Normalize(GeometryState saved, Rectangle[] areas)
        {
            if (areas == null || areas.Length == 0) areas = new Rectangle[] { new Rectangle(0, 0, 1024, 768) };
            Rectangle requested = saved == null ? new Rectangle(areas[0].X + 40, areas[0].Y + 40, 1000, 760) : saved.NormalBounds;
            Rectangle selected = areas[0];
            long bestIntersection = -1;
            double bestDistance = Double.MaxValue;
            foreach (Rectangle area in areas)
            {
                Rectangle overlap = Rectangle.Intersect(requested, area);
                long intersection = (long)Math.Max(0, overlap.Width) * Math.Max(0, overlap.Height);
                double dx = (double)requested.X + requested.Width / 2.0 - area.X - area.Width / 2.0;
                double dy = (double)requested.Y + requested.Height / 2.0 - area.Y - area.Height / 2.0;
                double distance = dx * dx + dy * dy;
                if (intersection > bestIntersection || (intersection == bestIntersection && distance < bestDistance))
                { selected = area; bestIntersection = intersection; bestDistance = distance; }
            }
            int width = Math.Max(Math.Min(360, selected.Width), Math.Min(requested.Width, selected.Width));
            int height = Math.Max(Math.Min(300, selected.Height), Math.Min(requested.Height, selected.Height));
            int x = Math.Max(selected.X, Math.Min(requested.X, selected.Right - width));
            int y = Math.Max(selected.Y, Math.Min(requested.Y, selected.Bottom - height));
            return new GeometryState(new Rectangle(x, y, width, height), saved != null && saved.Maximized);
        }
        internal static GeometryState ForFocus(GeometryState tracked, Rectangle liveBounds, Rectangle restoreBounds,
            FormWindowState windowState, Rectangle[] areas)
        {
            // Locate uses the live normal/restore OUTER frame, not startup geometry or min/max dimensions.
            // Focusing unminimizes to the pre-minimize state; an already-maximized window stays maximized.
            Rectangle normal = windowState == FormWindowState.Normal ? liveBounds : restoreBounds;
            bool maximized = windowState == FormWindowState.Maximized
                || (windowState == FormWindowState.Minimized && tracked.Maximized);
            return Normalize(new GeometryState(normal, maximized), areas);
        }
        internal static void Save(string stateData, GeometryState state)
        {
            // Profile geometry is the last successful atomic save; per-client browser caches stay separate.
            // Persist the normal OUTER rectangle, never WebView client size.
            string path = Path.Combine(stateData, Filename);
            SafePaths.RejectReparseLeaf(path);
            string temporary = Path.Combine(stateData, "window-bounds-" + Guid.NewGuid().ToString("N") + ".tmp");
            using (FileStream stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            using (StreamWriter writer = new StreamWriter(stream, WireProtocol.Utf8)) writer.Write(state.Json);
            // Atomic replacement only of the explicitly owned geometry file. No directory cleanup/data deletion.
            if (File.Exists(path)) File.Replace(temporary, path, null);
            else File.Move(temporary, path);
        }
    }
}
