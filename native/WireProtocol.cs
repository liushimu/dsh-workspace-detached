using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace WorkspaceNavigator
{
    internal sealed class ProtocolException : Exception
    {
        internal ProtocolException(string code) : base(code) { }
    }

    internal enum JsonKind { Object, Array, String, Number, Boolean, Null }

    // Preserve payload JSON exactly: reserializing HTML/SVG text must not expand the 4 MiB budget.
    internal sealed class JsonToken
    {
        internal readonly string Source;
        internal readonly int Start;
        internal readonly int End;
        internal readonly JsonKind Kind;
        internal JsonToken(string source, int start, int end, JsonKind kind)
        { Source = source; Start = start; End = end; Kind = kind; }
        internal string Raw { get { return Source.Substring(Start, End - Start); } }
        internal string Text
        {
            get
            {
                if (Kind != JsonKind.String) throw new ProtocolException("invalid-message");
                return StrictJson.DecodeString(Raw);
            }
        }
    }

    // A bounded JSON scanner rather than JavaScriptSerializer (which accepts duplicate keys and dates).
    // Only root fields are retained; nested data is checked once and remains opaque to this carrier.
    internal sealed class StrictJson
    {
        private readonly string source;
        private int position;
        private int nodes;
        private const int MaxDepth = 64;
        private const int MaxNodes = 500000;
        private StrictJson(string text) { source = text; }

        internal static Dictionary<string, JsonToken> Object(string text)
        {
            StrictJson parser = new StrictJson(text);
            parser.Space();
            Dictionary<string, JsonToken> root = parser.ReadObject(0, true);
            parser.Space();
            if (parser.position != text.Length) throw new ProtocolException("invalid-message");
            return root;
        }
        private void Space()
        {
            while (position < source.Length && (source[position] == ' ' || source[position] == '\t'
                || source[position] == '\r' || source[position] == '\n')) position++;
        }
        private void Take(char value)
        {
            if (position >= source.Length || source[position++] != value)
                throw new ProtocolException("invalid-message");
        }
        private Dictionary<string, JsonToken> ReadObject(int depth, bool retain)
        {
            if (depth > MaxDepth) throw new ProtocolException("invalid-message");
            Take('{'); Space();
            HashSet<string> names = new HashSet<string>(StringComparer.Ordinal);
            Dictionary<string, JsonToken> fields = retain ? new Dictionary<string, JsonToken>(StringComparer.Ordinal) : null;
            if (position < source.Length && source[position] == '}') { position++; return fields; }
            while (true)
            {
                int nameStart = position;
                ReadString();
                string name = DecodeString(source.Substring(nameStart, position - nameStart));
                if (!names.Add(name)) throw new ProtocolException("invalid-message");
                Space(); Take(':'); Space();
                JsonToken token = Value(depth + 1);
                if (retain) fields.Add(name, token);
                Space();
                if (position < source.Length && source[position] == '}') { position++; return fields; }
                Take(','); Space();
            }
        }
        private JsonToken Value(int depth)
        {
            if (depth > MaxDepth || ++nodes > MaxNodes || position >= source.Length)
                throw new ProtocolException("invalid-message");
            int start = position;
            JsonKind kind;
            char next = source[position];
            if (next == '{') { kind = JsonKind.Object; ReadObject(depth, false); }
            else if (next == '[')
            {
                kind = JsonKind.Array; position++; Space();
                if (position < source.Length && source[position] == ']') position++;
                else while (true)
                {
                    Value(depth + 1); Space();
                    if (position < source.Length && source[position] == ']') { position++; break; }
                    Take(','); Space();
                }
            }
            else if (next == '"') { kind = JsonKind.String; ReadString(); }
            else if (next == 't') { kind = JsonKind.Boolean; Literal("true"); }
            else if (next == 'f') { kind = JsonKind.Boolean; Literal("false"); }
            else if (next == 'n') { kind = JsonKind.Null; Literal("null"); }
            else { kind = JsonKind.Number; Number(); }
            return new JsonToken(source, start, position, kind);
        }
        private void Literal(string value)
        {
            for (int i = 0; i < value.Length; i++) Take(value[i]);
        }
        private void Number()
        {
            if (position < source.Length && source[position] == '-') position++;
            if (position >= source.Length) throw new ProtocolException("invalid-message");
            if (source[position] == '0') position++;
            else
            {
                if (source[position] < '1' || source[position] > '9') throw new ProtocolException("invalid-message");
                while (position < source.Length && source[position] >= '0' && source[position] <= '9') position++;
            }
            if (position < source.Length && source[position] == '.')
            {
                position++; Digits();
            }
            if (position < source.Length && (source[position] == 'e' || source[position] == 'E'))
            {
                position++;
                if (position < source.Length && (source[position] == '+' || source[position] == '-')) position++;
                Digits();
            }
        }
        private void Digits()
        {
            int start = position;
            while (position < source.Length && source[position] >= '0' && source[position] <= '9') position++;
            if (position == start) throw new ProtocolException("invalid-message");
        }
        private void ReadString()
        {
            Take('"');
            while (position < source.Length)
            {
                char value = source[position++];
                if (value == '"') return;
                if (value < 32) throw new ProtocolException("invalid-message");
                if (value != '\\') continue;
                if (position >= source.Length) throw new ProtocolException("invalid-message");
                char escaped = source[position++];
                if (escaped == 'u')
                {
                    for (int i = 0; i < 4; i++)
                    {
                        if (position >= source.Length || Hex(source[position++]) < 0)
                            throw new ProtocolException("invalid-message");
                    }
                }
                else if ("\"\\/bfnrt".IndexOf(escaped) < 0) throw new ProtocolException("invalid-message");
            }
            throw new ProtocolException("invalid-message");
        }
        private static int Hex(char value)
        {
            if (value >= '0' && value <= '9') return value - '0';
            if (value >= 'a' && value <= 'f') return value - 'a' + 10;
            if (value >= 'A' && value <= 'F') return value - 'A' + 10;
            return -1;
        }
        internal static string DecodeString(string raw)
        {
            StringBuilder result = new StringBuilder(raw.Length - 2);
            for (int i = 1; i < raw.Length - 1; i++)
            {
                char value = raw[i];
                if (value != '\\') { result.Append(value); continue; }
                value = raw[++i];
                if (value == 'u')
                {
                    int code = 0;
                    for (int j = 0; j < 4; j++) code = code * 16 + Hex(raw[++i]);
                    result.Append((char)code);
                }
                else if (value == 'b') result.Append('\b');
                else if (value == 'f') result.Append('\f');
                else if (value == 'n') result.Append('\n');
                else if (value == 'r') result.Append('\r');
                else if (value == 't') result.Append('\t');
                else result.Append(value);
            }
            return result.ToString();
        }
    }

    internal sealed class WireMessage
    {
        internal string Op;
        internal string Id;
        internal JsonToken Value;
    }

    internal static class AssetPolicy
    {
        internal const string InitialUrl = "https://navigator.local/workspace-navigator.html";
        internal static bool Allowed(string url, string method)
        {
            return method == "GET" && (url == InitialUrl
                || url == "https://navigator.local/workspace-navigator.js"
                || url == "https://navigator.local/workspace-navigator.css");
        }
    }

    internal static class WireProtocol
    {
        internal const int MaxInnerBytes = 4 * 1024 * 1024;
        internal const int MaxCarrierBytes = MaxInnerBytes + 1024;
        internal const int MaxPending = 128;
        internal static readonly Encoding Utf8 = new UTF8Encoding(false, true);
        internal static bool ValidId(string value)
        {
            if (value == null || value.Length == 0 || value.Length > 128) return false;
            foreach (char item in value)
                if (!(item >= 'a' && item <= 'z') && !(item >= 'A' && item <= 'Z')
                    && !(item >= '0' && item <= '9') && item != '-' && item != '_') return false;
            return true;
        }
        internal static void Fields(Dictionary<string, JsonToken> fields, params string[] expected)
        {
            if (fields.Count != expected.Length) throw new ProtocolException("invalid-message");
            foreach (string name in expected) if (!fields.ContainsKey(name)) throw new ProtocolException("invalid-message");
        }
        internal static WireMessage Parse(string text, bool fromHost)
        {
            if (Utf8.GetByteCount(text) > MaxCarrierBytes) throw new ProtocolException("frame-too-large");
            Dictionary<string, JsonToken> fields = StrictJson.Object(text);
            JsonToken op;
            if (!fields.TryGetValue("op", out op) || op.Kind != JsonKind.String) throw new ProtocolException("invalid-message");
            WireMessage message = new WireMessage();
            message.Op = op.Text;
            if (fromHost)
            {
                if (message.Op == "close" || message.Op == "focus") Fields(fields, "op");
                else if (message.Op == "model")
                {
                    Fields(fields, "op", "model");
                    message.Value = fields["model"];
                    if (message.Value.Kind != JsonKind.Object) throw new ProtocolException("invalid-message");
                }
                else if (message.Op == "result")
                {
                    Fields(fields, "op", "id", "value");
                    message.Id = fields["id"].Text;
                    message.Value = fields["value"];
                }
                else throw new ProtocolException("unknown-operation");
            }
            else
            {
                if (message.Op == "ready") Fields(fields, "op", "id");
                else if (message.Op == "rendered" || message.Op == "command")
                {
                    Fields(fields, "op", "id", "value");
                    message.Value = fields["value"];
                    if (message.Value.Kind != JsonKind.Object) throw new ProtocolException("invalid-message");
                }
                else throw new ProtocolException("unknown-operation");
                message.Id = fields["id"].Text;
            }
            if (message.Id != null && !ValidId(message.Id)) throw new ProtocolException("invalid-message");
            if (message.Value != null && Utf8.GetByteCount(message.Value.Raw) > MaxInnerBytes)
                throw new ProtocolException("payload-too-large");
            return message;
        }
        internal static string Compact(string value)
        {
            StringBuilder result = new StringBuilder(value.Length);
            bool quoted = false;
            bool escaped = false;
            foreach (char item in value)
            {
                if (quoted)
                {
                    result.Append(item);
                    if (escaped) escaped = false;
                    else if (item == '\\') escaped = true;
                    else if (item == '"') quoted = false;
                }
                else if (item == '"') { quoted = true; result.Append(item); }
                else if (item != ' ' && item != '\t' && item != '\r' && item != '\n') result.Append(item);
            }
            return result.ToString();
        }
        internal static string Quote(string value)
        {
            StringBuilder result = new StringBuilder(value.Length + 2);
            result.Append('"');
            foreach (char item in value)
            {
                if (item == '"' || item == '\\') { result.Append('\\'); result.Append(item); }
                else if (item < 32 || Char.IsSurrogate(item))
                { result.Append("\\u"); result.Append(((int)item).ToString("x4", CultureInfo.InvariantCulture)); }
                else result.Append(item);
            }
            result.Append('"');
            return result.ToString();
        }
        internal static string Failure(string id, string code)
        {
            return "{\"op\":\"result\",\"id\":" + Quote(id) + ",\"value\":{\"error\":" + Quote(code) + "}}";
        }
    }

    internal sealed class BoundedLineReader
    {
        private readonly Stream stream;
        private readonly byte[] chunk = new byte[8192];
        private readonly byte[] frame = new byte[WireProtocol.MaxCarrierBytes];
        private int chunkOffset;
        private int chunkLength;
        internal BoundedLineReader(Stream source) { stream = source; }
        internal string ReadLine()
        {
            int length = 0;
            while (true)
            {
                if (chunkOffset == chunkLength)
                {
                    chunkLength = stream.Read(chunk, 0, chunk.Length); chunkOffset = 0;
                    if (chunkLength == 0)
                    {
                        if (length != 0) throw new ProtocolException("truncated-frame");
                        return null;
                    }
                }
                byte value = chunk[chunkOffset++];
                if (value == 10)
                {
                    if (length > 0 && frame[length - 1] == 13) length--;
                    if (length == 0) throw new ProtocolException("invalid-message");
                    try { return WireProtocol.Utf8.GetString(frame, 0, length); }
                    catch (DecoderFallbackException) { throw new ProtocolException("invalid-utf8"); }
                }
                if (length >= frame.Length) throw new ProtocolException("frame-too-large");
                frame[length++] = value;
            }
        }
    }

    internal sealed class WireOutput
    {
        private readonly TextWriter writer;
        private readonly object gate = new object();
        internal WireOutput(Stream stream)
        {
            StreamWriter output = new StreamWriter(stream, new UTF8Encoding(false));
            output.AutoFlush = true; output.NewLine = "\n"; writer = output;
        }
        internal void Send(string json)
        {
            if (WireProtocol.Utf8.GetByteCount(json) > WireProtocol.MaxCarrierBytes)
                throw new ProtocolException("frame-too-large");
            lock (gate) writer.WriteLine(json);
        }
        internal void Error(string code) { Send("{\"op\":\"error\",\"code\":" + WireProtocol.Quote(code) + "}"); }
    }
}
