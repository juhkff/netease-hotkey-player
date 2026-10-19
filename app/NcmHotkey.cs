// NcmHotkey —— 网易云音乐「一键播放指定歌曲的指定位置」热键工具
//
// 界面程序：打开后可以配置「按键 + 歌曲 ID + 开始秒数」，挂在后台托盘里，
// 在任何界面按下热键都会让已经在运行的网易云音乐播放指定歌曲并跳到指定位置。
//
// 播放本身交给同目录下的 worker.mjs（Node）通过 CDP 驱动网易云客户端完成。
// 编译：见 tools/build.ps1（用系统自带的 csc.exe，无需任何下载）。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Xml;
using Microsoft.Win32;

[assembly: System.Reflection.AssemblyVersion("1.0.6.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.6.0")]

namespace NcmHotkey
{
    // Store applications must be activated with their application identity;
    // directly executing a WindowsApps binary can fail with access denied.
    public static class CloudMusicStore
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern int PackageFamilyNameFromFullName(string fullName, ref uint length, StringBuilder familyName);

        [ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        interface IApplicationActivationManager
        {
            void ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appId,
                [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
        }

        public static string GetAppIdForExecutable(string executable)
        {
            if (string.IsNullOrEmpty(executable)) return null;
            try
            {
                DirectoryInfo root = new FileInfo(executable).Directory;
                while (root != null)
                {
                    string manifest = Path.Combine(root.FullName, "AppxManifest.xml");
                    if (File.Exists(manifest))
                    {
                        XmlDocument document = new XmlDocument();
                        document.XmlResolver = null;
                        document.Load(manifest);
                        XmlNamespaceManager ns = new XmlNamespaceManager(document.NameTable);
                        ns.AddNamespace("p", "http://schemas.microsoft.com/appx/manifest/foundation/windows10");
                        foreach (XmlNode app in document.SelectNodes("/p:Package/p:Applications/p:Application", ns))
                        {
                            XmlAttribute target = app.Attributes["Executable"], id = app.Attributes["Id"];
                            if (target == null || id == null) continue;
                            if (!string.Equals(Path.GetFullPath(Path.Combine(root.FullName, target.Value)),
                                Path.GetFullPath(executable), StringComparison.OrdinalIgnoreCase)) continue;
                            uint size = 0;
                            if (PackageFamilyNameFromFullName(root.Name, ref size, null) != 122) return null;
                            StringBuilder family = new StringBuilder((int)size);
                            if (PackageFamilyNameFromFullName(root.Name, ref size, family) == 0)
                                return family.ToString() + "!" + id.Value;
                        }
                        return null;
                    }
                    root = root.Parent;
                }
            }
            catch { }
            return null;
        }

        public static string FindInstalledAppId()
        {
            try
            {
                using (RegistryKey packages = Registry.CurrentUser.OpenSubKey(
                    @"Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages"))
                {
                    if (packages == null) return null;
                    foreach (string name in packages.GetSubKeyNames())
                    {
                        using (RegistryKey package = packages.OpenSubKey(name))
                        {
                            if (package == null) continue;
                            string displayName = Convert.ToString(package.GetValue("DisplayName"));
                            if (displayName.IndexOf("网易云", StringComparison.OrdinalIgnoreCase) < 0 &&
                                displayName.IndexOf("CloudMusic", StringComparison.OrdinalIgnoreCase) < 0) continue;
                            string root = Convert.ToString(package.GetValue("PackageRootFolder"));
                            if (root.Length == 0) continue;
                            XmlDocument document = new XmlDocument();
                            document.XmlResolver = null;
                            document.Load(Path.Combine(root, "AppxManifest.xml"));
                            foreach (XmlNode app in document.GetElementsByTagName("Application"))
                            {
                                XmlAttribute executable = app.Attributes["Executable"];
                                if (executable == null || !string.Equals(Path.GetFileName(executable.Value),
                                    "cloudmusic.exe", StringComparison.OrdinalIgnoreCase)) continue;
                                string id = GetAppIdForExecutable(Path.Combine(root, executable.Value));
                                if (id != null) return id;
                            }
                        }
                    }
                }
            }
            catch { }
            return null;
        }

        public static uint Activate(string appId, string arguments)
        {
            object manager = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")));
            try
            {
                uint processId;
                ((IApplicationActivationManager)manager).ActivateApplication(appId, arguments, 2, out processId);
                return processId;
            }
            finally { Marshal.ReleaseComObject(manager); }
        }
    }

    // ==================== 配置 ====================
    public class HotkeyBinding
    {
        public string hotkey { get; set; }
        public string songId { get; set; }
        public double seconds { get; set; }
        public string note { get; set; }

        public HotkeyBinding() { hotkey = ""; songId = ""; seconds = 0; note = ""; }
        public HotkeyBinding Clone()
        {
            return new HotkeyBinding { hotkey = hotkey, songId = songId, seconds = seconds, note = note };
        }
    }

    public class AppConfig
    {
        public int port { get; set; }
        public List<HotkeyBinding> hotkeys { get; set; }
        /// <summary>「复位」热键：把音乐退回按片段键之前的那首歌、那个位置。空字符串=不启用。</summary>
        public string restoreHotkey { get; set; }
        /// <summary>点歌机模式：按片段键时先记下中断点，之后按复位键回到中断点。</summary>
        public bool clipMode { get; set; }
        /// <summary>是否弹托盘气泡通知。默认关（保持静默），结果只显示在状态栏和日志里。</summary>
        public bool notify { get; set; }
        public bool gameEventsEnabled { get; set; }
        public int awooPort { get; set; }
        public List<GameEventRule> gameEvents { get; set; }
        public AppConfig() { port = 9229; awooPort = 5555; hotkeys = new List<HotkeyBinding>(); restoreHotkey = ""; clipMode = true; notify = false; gameEvents = new List<GameEventRule>(); }
    }

    // ==================== 全局热键 ====================
    public static class HotkeyApi
    {
        public const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_WIN = 8;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool DestroyIcon(IntPtr hIcon);

        /// <summary>
        /// 程序自己的图标：蓝色圆角方块 + 白色播放三角 + 右下角一个小圆点。
        /// 不用网易云的图标 —— 那个是在托盘里根本分不出谁是谁。
        /// </summary>
        public static Icon MakeAppIcon(int size)
        {
            Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.Clear(Color.Transparent);

                int pad = Math.Max(1, size / 16);
                Rectangle r = new Rectangle(pad, pad, size - pad * 2 - 1, size - pad * 2 - 1);
                int rad = Math.Max(2, size / 4);
                using (GraphicsPath p = RoundRect(r, rad))
                using (LinearGradientBrush br = new LinearGradientBrush(r,
                           Color.FromArgb(255, 58, 138, 255), Color.FromArgb(255, 20, 74, 186), 55f))
                    g.FillPath(br, p);

                float s = size;
                PointF[] tri = new PointF[] {
                    new PointF(s * 0.34f, s * 0.26f),
                    new PointF(s * 0.34f, s * 0.74f),
                    new PointF(s * 0.76f, s * 0.50f)
                };
                g.FillPolygon(Brushes.White, tri);
            }

            IntPtr h = bmp.GetHicon();
            try { return (Icon)Icon.FromHandle(h).Clone(); }
            finally { DestroyIcon(h); bmp.Dispose(); }
        }

        static GraphicsPath RoundRect(Rectangle r, int radius)
        {
            int d = radius * 2;
            GraphicsPath p = new GraphicsPath();
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        static readonly Dictionary<string, uint> Mods = new Dictionary<string, uint>(StringComparer.OrdinalIgnoreCase)
        {
            {"alt", MOD_ALT}, {"ctrl", MOD_CONTROL}, {"control", MOD_CONTROL},
            {"shift", MOD_SHIFT}, {"win", MOD_WIN}, {"meta", MOD_WIN}, {"super", MOD_WIN}
        };

        static readonly Dictionary<string, uint> Named = new Dictionary<string, uint>(StringComparer.OrdinalIgnoreCase)
        {
            {"space",0x20},{"enter",0x0D},{"return",0x0D},{"tab",0x09},{"esc",0x1B},{"escape",0x1B},
            {"backspace",0x08},{"delete",0x2E},{"del",0x2E},{"insert",0x2D},{"home",0x24},{"end",0x23},
            {"pageup",0x21},{"pagedown",0x22},{"up",0x26},{"down",0x28},{"left",0x25},{"right",0x27},
            {"`",0xC0},{"-",0xBD},{"=",0xBB},{"[",0xDB},{"]",0xDD},{"\\",0xDC},
            {";",0xBA},{"'",0xDE},{",",0xBC},{".",0xBE},{"/",0xBF}
        };

        /// <summary>把 "Ctrl+Alt+1" 这样的字符串解析成修饰键和虚拟键码。</summary>
        public static bool Parse(string text, out uint mods, out uint vk, out string error)
        {
            mods = 0; vk = 0; error = null;
            if (string.IsNullOrWhiteSpace(text)) { error = "还没有设置按键"; return false; }
            // '+' is also the chord separator. A final literal plus means the
            // main keyboard's =/+ key; numpad '+' remains the distinct Add key.
            string chord = text.Trim();
            if (chord == "+") chord = "Oemplus";
            else if (chord.EndsWith("++", StringComparison.Ordinal))
                chord = chord.Substring(0, chord.Length - 1) + "Oemplus";
            foreach (string raw in chord.Split('+'))
            {
                string p = raw.Trim();
                if (p.Length == 0) { error = "按键格式不完整；加号键请用 Oemplus 或 Ctrl++"; return false; }
                if (Mods.ContainsKey(p)) { mods |= Mods[p]; continue; }
                uint candidate;
                if (!TryMainKey(p, out candidate)) { error = "看不懂的按键：" + p; return false; }
                if (vk != 0) { error = "一个热键只能包含一个主键"; return false; }
                vk = candidate;
            }
            if (vk == 0) { error = "按键里缺少主键，比如 Ctrl+Alt+1 里的那个 1"; return false; }
            return true;
        }

        static bool TryMainKey(string text, out uint key)
        {
            key = 0;
            if (Named.TryGetValue(text, out key)) return true;
            if (text.Length == 1 && ((text[0] >= '0' && text[0] <= '9') ||
                (text[0] >= 'A' && text[0] <= 'Z') || (text[0] >= 'a' && text[0] <= 'z')))
            { key = (uint)char.ToUpperInvariant(text[0]); return true; }
            // Preserve the Num0..Num9 names produced by older recorder versions.
            if (text.Length == 4 && text.StartsWith("Num", StringComparison.OrdinalIgnoreCase) &&
                text[3] >= '0' && text[3] <= '9')
            { key = (uint)(0x60 + text[3] - '0'); return true; }
            Keys parsed;
            if (char.IsLetter(text[0]) && text.IndexOf(',') < 0 &&
                Enum.TryParse<Keys>(text, true, out parsed) && Enum.IsDefined(typeof(Keys), parsed) &&
                (uint)parsed >= 8 && (uint)parsed <= 0xFE && !IsModifierKey(parsed))
            { key = (uint)parsed; return true; }
            return false;
        }

        public static bool IsModifierKey(Keys key)
        {
            return key == Keys.ControlKey || key == Keys.ShiftKey || key == Keys.Menu ||
                key == Keys.LControlKey || key == Keys.RControlKey ||
                key == Keys.LShiftKey || key == Keys.RShiftKey ||
                key == Keys.LMenu || key == Keys.RMenu || key == Keys.LWin || key == Keys.RWin;
        }

        /// <summary>把按下的组合键格式化成 "Ctrl+Alt+1"。</summary>
        public static string Format(Keys keyData)
        {
            StringBuilder sb = new StringBuilder();
            if ((keyData & Keys.Control) != 0) sb.Append("Ctrl+");
            if ((keyData & Keys.Alt) != 0) sb.Append("Alt+");
            if ((keyData & Keys.Shift) != 0) sb.Append("Shift+");

            Keys code = keyData & Keys.KeyCode;
            string name;
            if (code >= Keys.F1 && code <= Keys.F24) name = "F" + (code - Keys.F1 + 1);
            else if (code >= Keys.D0 && code <= Keys.D9) name = ((char)('0' + (code - Keys.D0))).ToString();
            else if (code >= Keys.NumPad0 && code <= Keys.NumPad9) name = "Num" + (code - Keys.NumPad0);
            else name = code.ToString();

            sb.Append(name);
            return sb.ToString();
        }

        public static string Humanize(double seconds)
        {
            if (seconds <= 0) return "从头播放";
            int total = (int)Math.Round(seconds);
            return string.Format(CultureInfo.InvariantCulture, "{0}:{1:00}", total / 60, total % 60);
        }
    }

    // Matches only the first key-down of each physical press. It never suppresses input.
    public sealed class HotkeyMatcher
    {
        class Binding { public int Id; public uint Modifiers, Key; }
        readonly List<Binding> bindings = new List<Binding>();
        readonly HashSet<uint> down = new HashSet<uint>();

        public bool Add(int id, uint modifiers, uint key)
        {
            foreach (Binding b in bindings)
                if (b.Id == id || (b.Modifiers == modifiers && b.Key == key)) return false;
            bindings.Add(new Binding { Id = id, Modifiers = modifiers, Key = key });
            return true;
        }

        public int? Observe(uint key, bool isDown, uint modifiers)
        {
            if (!isDown) { down.Remove(key); return null; }
            if (!down.Add(key)) return null;
            foreach (Binding b in bindings)
                if (b.Key == key && b.Modifiers == modifiers) return b.Id;
            return null;
        }

        public void Clear() { bindings.Clear(); down.Clear(); }
    }

    public sealed class PassiveHotkeys : IDisposable
    {
        delegate IntPtr KeyboardProc(int code, IntPtr message, IntPtr data);
        [DllImport("user32.dll", SetLastError = true)]
        static extern IntPtr SetWindowsHookEx(int id, KeyboardProc callback, IntPtr module, uint threadId);
        [DllImport("user32.dll", SetLastError = true)]
        static extern bool UnhookWindowsHookEx(IntPtr hook);
        [DllImport("user32.dll")]
        static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);
        [DllImport("user32.dll")]
        static extern short GetAsyncKeyState(int key);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr GetModuleHandle(string moduleName);

        readonly HotkeyMatcher matcher = new HotkeyMatcher();
        readonly KeyboardProc callback;
        IntPtr hook;
        public event Action<int> Pressed;
        public PassiveHotkeys() { callback = OnKeyboard; }
        public bool Add(int id, uint modifiers, uint key) { return matcher.Add(id, modifiers, key); }

        public void Start()
        {
            if (hook != IntPtr.Zero) return;
            hook = SetWindowsHookEx(13, callback, GetModuleHandle(null), 0); // WH_KEYBOARD_LL
            if (hook == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }

        static bool IsDown(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
        static uint Modifiers()
        {
            uint mods = 0;
            if (IsDown(0x12)) mods |= HotkeyApi.MOD_ALT;
            if (IsDown(0x11)) mods |= HotkeyApi.MOD_CONTROL;
            if (IsDown(0x10)) mods |= HotkeyApi.MOD_SHIFT;
            if (IsDown(0x5B) || IsDown(0x5C)) mods |= HotkeyApi.MOD_WIN;
            return mods;
        }

        IntPtr OnKeyboard(int code, IntPtr message, IntPtr data)
        {
            try
            {
                if (code >= 0 && (Marshal.ReadInt32(data, 8) & 0x10) == 0) // Ignore injected events.
                {
                    int kind = message.ToInt32();
                    if (kind == 0x100 || kind == 0x104 || kind == 0x101 || kind == 0x105)
                    {
                        int? id = matcher.Observe((uint)Marshal.ReadInt32(data),
                            kind == 0x100 || kind == 0x104, Modifiers());
                        if (id.HasValue && Pressed != null) Pressed(id.Value);
                    }
                }
            }
            catch { } // A listener failure must never interfere with the original keystroke.
            return CallNextHookEx(hook, code, message, data);
        }

        public void Dispose()
        {
            if (hook != IntPtr.Zero) { UnhookWindowsHookEx(hook); hook = IntPtr.Zero; }
            matcher.Clear();
        }
    }

    // ==================== 私有运行时 ====================
    public static class RuntimePaths
    {
        static string Existing(string path, string baseDir)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            try
            {
                path = Environment.ExpandEnvironmentVariables(path.Trim().Trim('"'));
                if (!Path.IsPathRooted(path)) path = Path.Combine(baseDir, path);
                path = Path.GetFullPath(path);
                return File.Exists(path) ? path : null;
            }
            catch (ArgumentException) { return null; }
            catch (NotSupportedException) { return null; }
            catch (IOException) { return null; }
        }

        public static string FindNode(string appDir)
        {
            // 新版发行包自带运行时，不依赖全局安装或 Explorer 的 PATH。
            foreach (string relative in new string[] { @"runtime\node.exe", "node.exe" })
            {
                string bundled = Existing(relative, appDir);
                if (bundled != null) return bundled;
            }
            try
            {
                string hint = Path.Combine(appDir, "node.txt");
                if (File.Exists(hint))
                {
                    string configured = Existing(File.ReadAllText(hint), appDir);
                    if (configured != null) return configured;
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            string path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (string entry in path.Split(Path.PathSeparator))
            {
                if (string.IsNullOrWhiteSpace(entry)) continue;
                string found = Existing(Path.Combine(entry.Trim().Trim('"'), "node.exe"), appDir);
                if (found != null) return found;
            }
            foreach (string root in new string[] {
                Environment.GetEnvironmentVariable("ProgramFiles"),
                Environment.GetEnvironmentVariable("ProgramFiles(x86)") })
            {
                if (string.IsNullOrEmpty(root)) continue;
                string found = Existing(Path.Combine(root, @"nodejs\node.exe"), appDir);
                if (found != null) return found;
            }
            return null;
        }
    }

    // ==================== Node 工作进程 ====================
    public class PlayWorker : IDisposable
    {
        Process proc;
        readonly object processLock = new object();
        int nextId = 1;
        readonly Dictionary<int, Action<Dictionary<string, object>>> pending =
            new Dictionary<int, Action<Dictionary<string, object>>>();
        readonly Dictionary<int, System.Threading.Timer> requestTimers = new Dictionary<int, System.Threading.Timer>();
        public event Action<string> LogLine;

        static bool IsRunning(Process process)
        {
            if (process == null) return false;
            try { return !process.HasExited; }
            catch (InvalidOperationException) { return false; }
        }

        public bool Running { get { lock (processLock) { return IsRunning(proc); } } }

        public void Start(string nodeExe, string scriptPath, string workDir)
        {
            Dispose();
            ProcessStartInfo psi = new ProcessStartInfo(nodeExe, "\"" + scriptPath + "\"");
            psi.WorkingDirectory = workDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardInput = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            Process child = new Process();
            child.StartInfo = psi;
            child.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            { if (e.Data != null) OnStdout(child, e.Data); else OnWorkerEnded(child); };
            child.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            { if (e.Data != null && LogLine != null) LogLine(e.Data); };
            try
            {
                lock (processLock)
                {
                    // Only publish a Process after Start succeeds. A failed Start
                    // leaves an unassociated Process whose HasExited throws.
                    if (!child.Start()) throw new InvalidOperationException("播放服务未能启动");
                    proc = child;
                    child.BeginOutputReadLine();
                    child.BeginErrorReadLine();
                }
            }
            catch
            {
                lock (processLock) { if (proc == child) proc = null; }
                Release(child);
                throw;
            }
        }

        void OnStdout(Process child, string line)
        {
            Dictionary<string, object> msg;
            try { msg = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line); }
            catch { return; }
            if (msg == null || !msg.ContainsKey("id") || msg["id"] == null) return;

            int id;
            if (!int.TryParse(Convert.ToString(msg["id"], CultureInfo.InvariantCulture), out id)) return;
            Action<Dictionary<string, object>> cb = null;
            lock (processLock)
            {
                if (proc != child) return;
                cb = TakeCallback(id);
            }
            if (cb != null) cb(msg);
        }

        Action<Dictionary<string, object>> TakeCallback(int id)
        {
            lock (pending)
            {
                Action<Dictionary<string, object>> cb;
                if (!pending.TryGetValue(id, out cb)) return null;
                pending.Remove(id);
                System.Threading.Timer timer;
                if (requestTimers.TryGetValue(id, out timer)) { requestTimers.Remove(id); timer.Dispose(); }
                return cb;
            }
        }

        List<Action<Dictionary<string, object>>> TakeAllCallbacks()
        {
            lock (pending)
            {
                List<Action<Dictionary<string, object>>> callbacks =
                    new List<Action<Dictionary<string, object>>>(pending.Values);
                pending.Clear();
                foreach (System.Threading.Timer timer in requestTimers.Values) timer.Dispose();
                requestTimers.Clear();
                return callbacks;
            }
        }

        void OnWorkerEnded(Process child)
        {
            List<Action<Dictionary<string, object>>> callbacks;
            lock (processLock)
            {
                if (proc != child) return;
                proc = null;
                callbacks = TakeAllCallbacks();
            }
            Release(child);
            foreach (Action<Dictionary<string, object>> cb in callbacks)
                Reply(cb, "播放服务已退出，请重试（详细信息见 logs\\app.log）", null);
        }

        public void Send(Dictionary<string, object> cmd, Action<Dictionary<string, object>> callback)
        { Send(cmd, callback, 0); }

        public void Send(Dictionary<string, object> cmd, Action<Dictionary<string, object>> callback, int timeoutMs)
        {
            string error = null;
            Action<Dictionary<string, object>> failed = null;
            lock (processLock)
            {
                if (!IsRunning(proc)) { error = "播放服务没有在运行"; failed = callback; }
                else
                {
                    int id = nextId++;
                    Dictionary<string, object> request = new Dictionary<string, object>(cmd);
                    request["id"] = id;
                    if (timeoutMs > 0) request["deadlineMs"] = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds + timeoutMs;
                    lock (pending) {
                        if (callback != null) {
                            pending[id] = callback;
                            if (timeoutMs > 0) {
                                Process child = proc;
                                System.Threading.Timer timer = new System.Threading.Timer(delegate { ExpireRequest(child, id); }, null,
                                    System.Threading.Timeout.Infinite, System.Threading.Timeout.Infinite);
                                requestTimers[id] = timer; timer.Change(timeoutMs, System.Threading.Timeout.Infinite);
                            }
                        }
                    }
                    try
                    {
                        // Framework's redirected StandardInput writer uses the
                        // local console encoding. Node reads UTF-8, so Chinese
                        // search terms must be sent as explicit UTF-8 bytes.
                        byte[] line = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(request) + "\n");
                        Stream input = proc.StandardInput.BaseStream;
                        input.Write(line, 0, line.Length);
                        input.Flush();
                    }
                    catch (Exception ex)
                    {
                        failed = TakeCallback(id);
                        error = "播放服务通信失败：" + ex.Message;
                    }
                }
            }
            if (failed != null) Reply(failed, error, null);
        }

        void ExpireRequest(Process child, int id)
        {
            Action<Dictionary<string, object>> callback = null;
            lock (processLock) { if (proc == child) callback = TakeCallback(id); }
            if (callback != null) Reply(callback, "请求等待超时，中断点保留在播放服务中，可重试", null);
        }

        static void Reply(Action<Dictionary<string, object>> cb, string error, Dictionary<string, object> extra)
        {
            Dictionary<string, object> m = new Dictionary<string, object>();
            m["ok"] = false;
            m["error"] = error;
            if (extra != null) foreach (var kv in extra) m[kv.Key] = kv.Value;
            cb(m);
        }

        static void Release(Process process)
        {
            if (process == null) return;
            try { if (IsRunning(process)) process.Kill(); } catch { }
            try { process.Dispose(); } catch { }
        }

        public void Dispose()
        {
            Process old;
            List<Action<Dictionary<string, object>>> callbacks;
            lock (processLock)
            {
                old = proc;
                proc = null;
                callbacks = TakeAllCallbacks();
            }
            Release(old);
            foreach (Action<Dictionary<string, object>> cb in callbacks)
                Reply(cb, "播放服务已停止", null);
        }
    }

    // ==================== 添加 / 编辑 对话框 ====================
    public class BindingDialog : Form
    {
        TextBox hotkeyBox = new TextBox();
        TextBox searchBox = new TextBox();
        ListView results = new ListView();
        TextBox idBox = new TextBox();
        Label selected = new Label();
        NumericUpDown secBox = new NumericUpDown();
        TextBox noteBox = new TextBox();
        bool capturing = false;
        int searchVersion;
        readonly PlayWorker worker;
        readonly int port;

        public HotkeyBinding Result { get; private set; }

        public BindingDialog(HotkeyBinding src, PlayWorker worker, int port) : this(src, worker, port, false) { }
        public BindingDialog(HotkeyBinding src, PlayWorker worker, int port, bool songOnly)
        {
            this.worker = worker;
            this.port = port;

            Text = songOnly ? "选择事件播放的歌曲" : src == null ? "添加一条热键" : "编辑热键";
            Font = new Font("Microsoft YaHei UI", 9F);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false; MinimizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(640, 486);

            // ---------- 按键 ----------
            Label l1 = new Label();
            l1.Text = "按  键"; l1.Location = new Point(18, 22); l1.Size = new Size(76, 20);
            hotkeyBox.Location = new Point(100, 19); hotkeyBox.Size = new Size(200, 26);
            hotkeyBox.ReadOnly = true;
            hotkeyBox.BackColor = Color.White;
            hotkeyBox.TextAlign = HorizontalAlignment.Center;
            hotkeyBox.Enter += delegate { capturing = true; hotkeyBox.Text = "请按下组合键…"; };
            hotkeyBox.Leave += delegate { capturing = false; };
            Label l1b = new Label();
            l1b.Text = "点进这个框，然后直接按你想用的组合键";
            l1b.ForeColor = Color.Gray;
            l1b.Location = new Point(310, 22); l1b.Size = new Size(310, 20);

            // ---------- 搜歌 ----------
            Label l2 = new Label();
            l2.Text = "搜  歌"; l2.Location = new Point(18, 60); l2.Size = new Size(76, 20);
            searchBox.Location = new Point(100, 57); searchBox.Size = new Size(330, 26);
            Button searchBtn = new Button();
            searchBtn.Text = "搜索"; searchBtn.Location = new Point(440, 56); searchBtn.Size = new Size(84, 28);
            searchBtn.Click += delegate { DoSearch(); };
            searchBox.KeyDown += delegate(object s, KeyEventArgs e)
            {
                if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; DoSearch(); }
            };

            results.View = View.Details;
            results.FullRowSelect = true;
            results.MultiSelect = false;
            results.HideSelection = false;
            results.Location = new Point(100, 92);
            results.Size = new Size(520, 168);
            results.Columns.Add("歌名", 200);
            results.Columns.Add("歌手", 140);
            results.Columns.Add("专辑", 130);
            results.Columns.Add("时长", 50);
            results.ItemSelectionChanged += delegate
            {
                if (results.SelectedItems.Count == 0) return;
                ListViewItem it = results.SelectedItems[0];
                idBox.Text = Convert.ToString(it.Tag);
                selected.Text = "已选中：" + it.Text + " · " + it.SubItems[1].Text +
                                "　《" + it.SubItems[2].Text + "》　ID " + idBox.Text;
                selected.ForeColor = Color.FromArgb(0, 120, 60);
                if (noteBox.Text.Trim().Length == 0)
                    noteBox.Text = it.Text + (it.SubItems[1].Text.Length > 0 ? " / " + it.SubItems[1].Text : "");
            };

            // ---------- 选中的歌 ----------
            Label l3 = new Label();
            l3.Text = "歌曲 ID"; l3.Location = new Point(18, 274); l3.Size = new Size(76, 20);
            idBox.Location = new Point(100, 271); idBox.Size = new Size(120, 26);
            selected.Text = "还没选歌 —— 先在上面搜一下";
            selected.ForeColor = Color.Gray;
            selected.Location = new Point(232, 274); selected.Size = new Size(390, 20);

            // ---------- 开始位置 ----------
            Label l4 = new Label();
            l4.Text = "开始位置"; l4.Location = new Point(18, 312); l4.Size = new Size(76, 20);
            secBox.Location = new Point(100, 309); secBox.Size = new Size(100, 26);
            secBox.Minimum = 0; secBox.Maximum = 86400; secBox.Increment = 1; secBox.Value = 0;
            Label l4b = new Label();
            l4b.Text = "秒。填 0 就是从歌曲开头播放";
            l4b.ForeColor = Color.Gray;
            l4b.Location = new Point(210, 312); l4b.Size = new Size(300, 20);

            // ---------- 备注 ----------
            Label l5 = new Label();
            l5.Text = "备  注"; l5.Location = new Point(18, 350); l5.Size = new Size(76, 20);
            noteBox.Location = new Point(100, 347); noteBox.Size = new Size(330, 26);
            Label l5b = new Label();
            l5b.Text = "（会显示在列表和托盘提示里）";
            l5b.ForeColor = Color.Gray;
            l5b.Location = new Point(440, 350); l5b.Size = new Size(190, 20);

            // ---------- 确定 / 取消 ----------
            Button ok = new Button();
            ok.Text = "确定"; ok.Location = new Point(420, 425); ok.Size = new Size(94, 32);
            ok.DialogResult = DialogResult.None;
            ok.Click += delegate
            {
                uint mods, vk; string err;
                string hk = hotkeyBox.Text.Trim();
                if (!songOnly && !HotkeyApi.Parse(hk, out mods, out vk, out err))
                {
                    MessageBox.Show(this, err, "按键不对", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    hotkeyBox.Focus();
                    return;
                }
                string song = idBox.Text.Trim();
                if (song.Length == 0 || !IsAllDigits(song))
                {
                    MessageBox.Show(this, "还没有选歌。先在上面搜索，然后从结果里点一首。", "还没选歌",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    searchBox.Focus();
                    return;
                }
                Result = new HotkeyBinding
                {
                    hotkey = hk,
                    songId = song,
                    seconds = (double)secBox.Value,
                    note = noteBox.Text.Trim()
                };
                DialogResult = DialogResult.OK;
                Close();
            };

            Button cancel = new Button();
            cancel.Text = "取消"; cancel.Location = new Point(524, 425); cancel.Size = new Size(94, 32);
            cancel.DialogResult = DialogResult.Cancel;

            Controls.AddRange(new Control[] {
                l1, hotkeyBox, l1b,
                l2, searchBox, searchBtn, results,
                l3, idBox, selected,
                l4, secBox, l4b,
                l5, noteBox, l5b,
                ok, cancel
            });
            AcceptButton = ok;
            CancelButton = cancel;
            if (songOnly) {
                Controls.Remove(l1); Controls.Remove(hotkeyBox); Controls.Remove(l1b);
                foreach (Control control in Controls) control.Top -= 38;
                ClientSize = new Size(640, 448);
            }

            if (src != null)
            {
                hotkeyBox.Text = src.hotkey;
                idBox.Text = src.songId;
                secBox.Value = (decimal)Math.Max(0, Math.Min(86400, src.seconds));
                noteBox.Text = src.note;
                if (src.songId.Length > 0)
                {
                    selected.Text = "当前：ID " + src.songId + (src.note.Length > 0 ? "　" + src.note : "");
                    selected.ForeColor = Color.FromArgb(0, 120, 60);
                }
            }
        }

        static bool IsAllDigits(string s)
        {
            foreach (char c in s) if (c < '0' || c > '9') return false;
            return s.Length > 0;
        }

        void SetSelectedInfo(string text, Color color)
        {
            selected.Text = text;
            selected.ForeColor = color;
        }

        // 组合键捕获：用 ProcessCmdKey 才能拿到 Tab / Alt 这类会被控件吃掉的键
        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (capturing)
            {
                Keys code = keyData & Keys.KeyCode;
                if (HotkeyApi.IsModifierKey(code))
                    return true; // 只按了修饰键，继续等主键

                hotkeyBox.Text = HotkeyApi.Format(keyData);
                capturing = false;
                return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        void DoSearch()
        {
            string kw = searchBox.Text.Trim();
            if (kw.Length == 0) { SetSelectedInfo("先输入歌名或歌手", Color.Firebrick); return; }
            if (worker == null || !worker.Running)
            {
                SetSelectedInfo("播放服务没在运行，搜不了", Color.Firebrick);
                return;
            }

            SetSelectedInfo("搜索中…", Color.Gray);
            results.Items.Clear();
            int version = ++searchVersion;

            Dictionary<string, object> cmd = new Dictionary<string, object>();
            cmd["cmd"] = "search";
            cmd["keyword"] = kw;
            cmd["limit"] = 30;
            cmd["port"] = port;

            worker.Send(cmd, delegate(Dictionary<string, object> r)
            {
                // 回调在读取 Node 输出的后台线程上跑，必须切回界面线程
                if (IsDisposed) return;
                try
                {
                    BeginInvoke((MethodInvoker)delegate
                    {
                        if (IsDisposed || version != searchVersion) return;
                        try { ApplySearchResults(r); }
                        catch (Exception ex) { SetSelectedInfo("显示搜索结果失败：" + ex.Message, Color.Firebrick); }
                    });
                }
                catch { }
            });
        }

        void ApplySearchResults(Dictionary<string, object> response)
        {
            bool ok = response.ContainsKey("ok") && response["ok"] is bool && (bool)response["ok"];
            if (!ok) { SetSelectedInfo("搜索失败：" + MainForm.Str(response, "error"), Color.Firebrick); return; }

            object raw;
            response.TryGetValue("list", out raw);
            // JavaScriptSerializer creates ArrayList for arrays nested in a
            // Dictionary<string, object>. Casting only to object[] loses every song.
            System.Collections.IList songs = raw as System.Collections.IList;
            if (songs == null)
            {
                SetSelectedInfo("搜索结果格式异常，请重试", Color.Firebrick);
                return;
            }
            results.BeginUpdate();
            try
            {
                results.Items.Clear();
                foreach (object value in songs)
                {
                    Dictionary<string, object> song = value as Dictionary<string, object>;
                    if (song == null) continue;
                    ListViewItem item = new ListViewItem(MainForm.Str(song, "name"));
                    item.SubItems.Add(MainForm.Str(song, "artists"));
                    item.SubItems.Add(MainForm.Str(song, "album"));
                    item.SubItems.Add(MainForm.DurationText(MainForm.Num(song, "duration")));
                    item.Tag = MainForm.Str(song, "id");
                    results.Items.Add(item);
                }
            }
            finally { results.EndUpdate(); }

            if (results.Items.Count == 0) SetSelectedInfo("没搜到，换个词试试", Color.Firebrick);
            else
            {
                SetSelectedInfo("从下面挑一首（共 " + results.Items.Count + " 首）", Color.Gray);
                if (results.Items.Count == 1) results.Items[0].Selected = true;
            }
        }
    }

    // ==================== 主窗口 ====================
    public class MainForm : Form
    {
        const int HOTKEY_ID_BASE = 0x4000;
        const int HOTKEY_ID_RESTORE = 0x4100;

        readonly string appDir;
        readonly string configPath;
        readonly JavaScriptSerializer json = new JavaScriptSerializer();
        AppConfig config = new AppConfig();
        readonly Dictionary<int, bool> registered = new Dictionary<int, bool>();
        readonly PassiveHotkeys hotkeys = new PassiveHotkeys();
        PlayWorker worker = new PlayWorker();

        ListView list = new ListView();
        StatusStrip statusStrip = new StatusStrip();
        ToolStripStatusLabel statusLabel = new ToolStripStatusLabel();
        NotifyIcon tray = new NotifyIcon();
        ToolStripMenuItem pauseItem = new ToolStripMenuItem();
        Timer pingTimer = new Timer();
        GameEventService gameEvents;
        string gameEventStatus = "游戏事件：未启用";
        GameEventsDialog gameEventsDialog;
        bool editingGameEvents;

        bool paused = false;
        bool exiting = false;
        bool trayTipShown = false;
        bool titlesFilled = false;
        bool restoreRegistered = false;
        bool capturingRestore = false;
        string restoreHint = "";
        string nodeExe = "node";
        string cloudMusicPath = null;
        int busyCount = 0;
        bool restorePending;
        bool playPending;
        bool startHidden = false;
        bool allowShow = false;
        bool inited = false;
        Icon appIcon = SystemIcons.Application;

        CheckBox clipCheck = new CheckBox();
        TextBox restoreBox = new TextBox();
        Button restoreCaptureBtn = new Button();
        Button restoreTestBtn = new Button();
        ToolStripMenuItem restoreItem = new ToolStripMenuItem();

        public MainForm() : this(false) { }

        public MainForm(bool startHidden)
        {
            this.startHidden = startHidden;
            appDir = Path.GetDirectoryName(Application.ExecutablePath);
            configPath = Path.Combine(appDir, "config.json");

            Text = "网易云一键播放 · 热键设置";
            Font = new Font("Microsoft YaHei UI", 9F);
            try { appIcon = HotkeyApi.MakeAppIcon(32); Icon = appIcon; } catch { }
            ClientSize = new Size(700, 510);
            MinimumSize = new Size(700, 380);
            StartPosition = FormStartPosition.CenterScreen;

            BuildUi();
            hotkeys.Pressed += OnHotkeyPressed;
            LoadConfig();
            UpdateClipUi();          // BuildUi 跑在 LoadConfig 之前，读到的还是默认配置，这里补一次
            ResolveNode();
            ResolveCloudMusic();

            BuildTray();
            RefreshList();

            Load += delegate { InitOnce(); };

            // 开机自启（--tray）时窗口从不显示，句柄不会自己创建、Load 也不会触发，
            // 所以这里主动把句柄建出来，让 OnHandleCreated 里的 InitOnce() 跑起来。
            if (startHidden) { IntPtr force = Handle; }
        }

        /// <summary>
        /// 真正的初始化。放在这里而不是只在 Load 里，是因为开机自启（--tray）时窗口从不显示，
        /// Load 事件根本不会触发 —— 那样热键就永远不会注册。
        /// </summary>
        void InitOnce()
        {
            if (inited) return;
            inited = true;
            worker.LogLine += OnWorkerLog;
            RegisterAll();
            pingTimer.Interval = 10000;
            pingTimer.Tick += delegate { Ping(); };
            pingTimer.Start();
            Ping();
            gameEvents = new GameEventService();
            gameEvents.StatusChanged += delegate(string text, long version) {
                Ui(delegate { if (!exiting && gameEvents != null && gameEvents.IsCurrent(version)) SetGameEventStatus(text); });
                Log("[游戏事件] " + text);
            };
            gameEvents.PlayRequested += delegate(GameEventRule rule, long version) {
                Ui(delegate {
                    if (exiting || editingGameEvents || paused || gameEvents == null || !gameEvents.IsCurrent(version)) return;
                    Log("[游戏事件] 触发 " + rule.eventId + " / " + GameEventCatalog.Slots(rule.playerSlots) + " / " + rule.songId);
                    PlaySong(rule.Song(), -1);
                });
            };
            ConfigureGameEvents();
        }

        void BuildUi()
        {
            list.View = View.Details;
            list.FullRowSelect = true;
            list.GridLines = false;
            list.MultiSelect = false;
            list.HideSelection = false;
            list.Dock = DockStyle.Fill;
            list.Columns.Add("按键", 150);
            list.Columns.Add("歌曲", 220);
            list.Columns.Add("开始位置", 90);
            list.Columns.Add("状态", 190);
            list.DoubleClick += delegate { if (list.SelectedItems.Count > 0) EditSelected(); };

            Panel toolbar = new Panel();
            toolbar.Dock = DockStyle.Top;
            toolbar.Height = 48;
            toolbar.Padding = new Padding(8, 8, 8, 8);

            Button addBtn = MakeButton("添加", 0, delegate { AddBinding(); });
            Button editBtn = MakeButton("编辑", 1, delegate { EditSelected(); });
            Button delBtn = MakeButton("删除", 2, delegate { DeleteSelected(); });
            Button testBtn = MakeButton("试一下", 3, delegate { TestSelected(); });
            Button launchBtn = MakeButton("启动网易云", 4, delegate { LaunchCloudMusic(); });
            Button folderBtn = MakeButton("打开目录", 5, delegate
            {
                try { Process.Start("explorer.exe", "\"" + appDir + "\""); } catch { }
            });

            toolbar.Controls.AddRange(new Control[] { addBtn, editBtn, delBtn, testBtn, launchBtn, folderBtn });
            Button eventsButton = MakeButton("游戏事件…", 6, delegate { EditGameEvents(); });
            toolbar.Controls.Add(eventsButton);

            Label hint = new Label();
            hint.Text = "程序会缩到右下角托盘里继续生效。双击列表里的一行可以修改。";
            hint.ForeColor = Color.Gray;
            hint.Dock = DockStyle.Bottom;
            hint.Height = 26;
            hint.TextAlign = ContentAlignment.MiddleLeft;
            hint.Padding = new Padding(10, 0, 0, 0);

            Panel bottom = new Panel();
            bottom.Dock = DockStyle.Bottom;
            bottom.Height = 44;
            bottom.Padding = new Padding(8, 6, 8, 6);

            clipCheck.Text = "点歌机模式：片段键先记住中断点，按复位键回到原处";
            clipCheck.Location = new Point(8, 10);
            clipCheck.AutoSize = true;
            clipCheck.Checked = config.clipMode;
            clipCheck.CheckedChanged += delegate
            {
                config.clipMode = clipCheck.Checked;
                SaveConfig();
                RegisterAll();
                UpdateClipUi();
            };

            Label rl = new Label();
            rl.Text = "复位键：";
            rl.Location = new Point(370, 12);
            rl.AutoSize = true;

            restoreBox.Location = new Point(428, 9);
            restoreBox.Size = new Size(120, 24);
            restoreBox.ReadOnly = true;
            restoreBox.Text = config.restoreHotkey;
            restoreBox.BackColor = Color.White;

            restoreCaptureBtn.Text = "设置";
            restoreCaptureBtn.Size = new Size(56, 25);
            restoreCaptureBtn.Location = new Point(552, 8);
            restoreCaptureBtn.Click += delegate { BeginCaptureRestore(); };

            restoreTestBtn.Text = "复位";
            restoreTestBtn.Size = new Size(56, 25);
            restoreTestBtn.Location = new Point(612, 8);
            restoreTestBtn.Click += delegate { DoRestore(); };

            bottom.Controls.AddRange(new Control[] { clipCheck, rl, restoreBox, restoreCaptureBtn, restoreTestBtn });

            statusLabel.Text = "正在启动…";
            statusStrip.Items.Add(statusLabel);
            statusStrip.SizingGrip = false;

            Controls.Add(list);
            Controls.Add(toolbar);
            Controls.Add(bottom);
            Controls.Add(hint);
            Controls.Add(statusStrip);
            UpdateClipUi();
        }

        /// <summary>点歌机模式关掉时，复位那一排控件就灰掉。</summary>
        void UpdateClipUi()
        {
            bool on = config.clipMode;
            clipCheck.Checked = on;
            restoreBox.Enabled = on;
            restoreCaptureBtn.Enabled = on;
            restoreTestBtn.Enabled = on && !restorePending;
            restoreBox.Text = on ? config.restoreHotkey : "";
        }

        Button MakeButton(string text, int index, EventHandler onClick)
        {
            Button b = new Button();
            b.Text = text;
            b.Size = new Size(90, 30);
            b.Location = new Point(8 + index * 96, 9);
            b.Click += onClick;
            return b;
        }

        void BuildTray()
        {
            // 用自己画的图标（蓝色播放三角），不用网易云的 —— 托盘里两个一样的图标分不清。
            Icon icon = appIcon;
            tray.Icon = icon;
            tray.Text = "网易云一键播放热键";
            tray.Visible = true;
            tray.DoubleClick += delegate { ShowMain(); };

            ContextMenuStrip menu = new ContextMenuStrip();
            menu.Font = Font;
            menu.Items.Add("打开设置", null, delegate { ShowMain(); });
            menu.Items.Add("游戏事件…", null, delegate { ShowMain(); EditGameEvents(); });
            restoreItem.Text = "复位到中断位置";
            restoreItem.Click += delegate { DoRestore(); };
            menu.Items.Add(restoreItem);
            pauseItem.Text = "暂停全部触发";
            pauseItem.CheckOnClick = false;
            pauseItem.Click += delegate { TogglePause(); };
            menu.Items.Add(pauseItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("退出", null, delegate { ExitApp(); });
            tray.ContextMenuStrip = menu;
        }

        void ShowMain()
        {
            allowShow = true;        // 解除 --tray 的隐藏门闩，保证一定能把窗口叫出来
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        /// <summary>开机自启（--tray）时不要闪一下窗口，直接只留托盘图标。</summary>
        protected override void SetVisibleCore(bool value)
        {
            if (startHidden && !allowShow)
            {
                allowShow = true;
                base.SetVisibleCore(false);
                return;
            }
            base.SetVisibleCore(value);
        }

        void TogglePause()
        {
            paused = !paused;
            pauseItem.Text = paused ? "恢复全部触发" : "暂停全部触发";
            if (paused) UnregisterAll(); else RegisterAll();
            ConfigureGameEvents();
            RefreshList();
            SetStatus(paused ? "热键已暂停" : "热键已生效");
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            InitOnce();
        }

        void OnHotkeyPressed(int id)
        {
            // Keep the hook callback short. Music work runs only after the original
            // keystroke has been passed on. Editing bindings must not play music.
            if (capturingRestore || editingGameEvents || Form.ActiveForm is BindingDialog || IsDisposed) return;
            try
            {
                BeginInvoke((MethodInvoker)delegate
                {
                    if (paused || exiting) return;
                    if (id == HOTKEY_ID_RESTORE) DoRestore();
                    else
                    {
                        int index = id - HOTKEY_ID_BASE;
                        if (index >= 0 && index < config.hotkeys.Count) Fire(index);
                    }
                });
            }
            catch (InvalidOperationException) { }
        }

        // ---------- 复位键的捕获 ----------
        void BeginCaptureRestore()
        {
            capturingRestore = true;
            restoreHint = config.restoreHotkey;
            restoreBox.Text = "请按组合键…（Esc 清除）";
            restoreBox.Focus();
        }

        /// <summary>捕获复位键。和对话框里一样：只按修饰键时继续等主键。</summary>
        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (!capturingRestore) return base.ProcessCmdKey(ref msg, keyData);
            Keys k = keyData & Keys.KeyCode;
            if (HotkeyApi.IsModifierKey(k))
                return true;

            capturingRestore = false;
            if (k == Keys.Escape) config.restoreHotkey = "";
            else config.restoreHotkey = HotkeyApi.Format(keyData);

            SaveConfig();
            UpdateClipUi();
            RegisterAll();
            SetStatus(config.restoreHotkey.Length > 0
                ? "复位键已设为 " + config.restoreHotkey
                : "复位键已清除");
            return true;
        }

        // ---------- 复位 ----------
        void DoRestore()
        {
            if (!config.clipMode || restorePending) return;
            if (gameEvents != null) gameEvents.CancelPending();
            restorePending = true; UpdateClipUi(); restoreItem.Enabled = false;
            busyCount++;
            Log("开始复位请求");
            SetStatus("正在复位…");
            worker.Send(new Dictionary<string, object> { { "cmd", "restore" }, { "port", config.port } },
                delegate(Dictionary<string, object> r)
                {
                    Ui(delegate
                    {
                        busyCount = Math.Max(0, busyCount - 1); restorePending = false; UpdateClipUi(); restoreItem.Enabled = config.clipMode;
                        bool ok = r.ContainsKey("ok") && r["ok"] is bool && (bool)r["ok"];
                        if (!ok)
                        {
                            string e = Str(r, "error");
                            Log("复位失败：" + e);
                            SetStatus("复位失败：" + e);
                            Notify("复位失败", e);
                            return;
                        }
                        if (r.ContainsKey("nothing") && r["nothing"] is bool && (bool)r["nothing"])
                        {
                            Log("复位结束：没有中断点");
                            SetStatus("还没有中断点：先按一个片段键，再按复位键。");
                            Notify("没有中断点", "先按一个片段键，再按复位键。");
                            return;
                        }
                        string name = Str(r, "name");
                        double sec = Num(r, "seeked");
                        string msg = "已复位：" + name + " · 从 " + HotkeyApi.Humanize(sec) + " 继续";
                        if (!(r.ContainsKey("wasPlaying") && r["wasPlaying"] is bool && (bool)r["wasPlaying"]))
                            msg += "（保持暂停）";
                        Log(msg);
                        SetStatus(msg);
                        Notify("已复位", msg);
                    });
                }, 30000);
        }

        // ---------- 配置读写 ----------
        void LoadConfig()
        {
            try
            {
                if (File.Exists(configPath))
                {
                    string text = File.ReadAllText(configPath, Encoding.UTF8);
                    AppConfig c = json.Deserialize<AppConfig>(text);
                    if (c != null)
                    {
                        config = c;
                        if (config.hotkeys == null) config.hotkeys = new List<HotkeyBinding>();
                        if (config.gameEvents == null) config.gameEvents = new List<GameEventRule>();
                        if (config.port <= 0) config.port = 9229;
                        if (config.awooPort != 0 && (config.awooPort < 1024 || config.awooPort > 65535)) config.awooPort = 5555;
                    }
                }
            }
            catch (Exception ex)
            {
                // 静默：不弹框，写日志和状态栏
                SetStatus("配置文件读不了，用空配置启动了（看 logs\\app.log）");
                Log("配置文件读不了：" + ex.Message);
            }
        }

        void SaveConfig()
        {
            try
            {
                File.WriteAllText(configPath, json.Serialize(config), new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                // 静默：不弹框，写日志和状态栏
                SetStatus("配置保存失败：" + ex.Message);
                Log("配置保存失败：" + ex.Message);
            }
        }

        void ConfigureGameEvents()
        {
            // Keep read-only monitoring alive while the dialog is open. The
            // PlayRequested handler suppresses playback until editing finishes.
            bool enabled = config.gameEventsEnabled && !paused;
            SetGameEventStatus(!enabled ? paused ? "游戏事件：已暂停" : "游戏事件：未启用" : "游戏事件：正在连接…");
            if (gameEvents != null) gameEvents.Configure(enabled, config.gameEvents);
        }
        void SetGameEventStatus(string text)
        {
            gameEventStatus = text;
            if (gameEventsDialog != null && !gameEventsDialog.IsDisposed) gameEventsDialog.UpdateMonitoringStatus(text);
        }
        void EditGameEvents()
        {
            if (editingGameEvents) return;
            editingGameEvents = true;
            try {
                using (GameEventsDialog dialog = new GameEventsDialog(config.gameEventsEnabled, config.gameEvents, config.hotkeys, worker, config.port)) {
                    gameEventsDialog = dialog;
                    dialog.UpdateMonitoringStatus(gameEventStatus);
                    ConfigureGameEvents();
                    if (dialog.ShowDialog(this) == DialogResult.OK) {
                        config.gameEventsEnabled = dialog.MonitoringEnabled; config.gameEvents = dialog.Result; SaveConfig();
                    }
                }
            } finally { gameEventsDialog = null; editingGameEvents = false; ConfigureGameEvents(); }
        }

        // ---------- 热键注册 ----------
        void RegisterAll()
        {
            UnregisterAll();
            if (paused) return;

            List<string> failures = new List<string>();
            for (int i = 0; i < config.hotkeys.Count; i++)
            {
                HotkeyBinding b = config.hotkeys[i];
                uint mods, vk; string err;
                if (!HotkeyApi.Parse(b.hotkey, out mods, out vk, out err))
                {
                    registered[i] = false;
                    failures.Add("第 " + (i + 1) + " 条：" + err);
                    continue;
                }
                bool ok = hotkeys.Add(HOTKEY_ID_BASE + i, mods, vk);
                registered[i] = ok;
                if (!ok)
                {
                    failures.Add("第 " + (i + 1) + " 条 " + b.hotkey + "：与另一条音乐热键重复");
                }
            }

            // 复位键（点歌机模式用）
            if (config.clipMode && !string.IsNullOrEmpty(config.restoreHotkey))
            {
                uint mods, vk; string err;
                if (!HotkeyApi.Parse(config.restoreHotkey, out mods, out vk, out err))
                {
                    failures.Add("复位键：" + err);
                }
                else
                {
                    restoreRegistered = hotkeys.Add(HOTKEY_ID_RESTORE, mods, vk);
                    if (!restoreRegistered)
                    {
                        failures.Add("复位键 " + config.restoreHotkey + "：与播放键重复");
                    }
                }
            }

            if (registered.ContainsValue(true) || restoreRegistered)
            {
                try { hotkeys.Start(); Log("按键监听已启用（保留原按键功能）"); }
                catch (Exception ex)
                {
                    hotkeys.Dispose();
                    for (int i = 0; i < config.hotkeys.Count; i++) registered[i] = false;
                    restoreRegistered = false;
                    failures.Add("按键监听启动失败：" + ex.Message);
                }
            }

            if (failures.Count > 0)
            {
                MessageBox.Show(this,
                    "下面这些热键没能生效：\n\n" + string.Join("\n", failures.ToArray()) +
                    "\n\n请检查按键设置后重试。",
                    "热键设置", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                SetStatus("有 " + failures.Count + " 个热键没生效");
            }
            else if (config.hotkeys.Count > 0 || restoreRegistered)
            {
                string extra = restoreRegistered ? "，外加复位键 " + config.restoreHotkey : "";
                SetStatus("热键已生效（共 " + (config.hotkeys.Count + (restoreRegistered ? 1 : 0)) + " 个" + extra + "）");
            }
        }

        void UnregisterAll()
        {
            hotkeys.Dispose();
            restoreRegistered = false;
            registered.Clear();
        }

        // ---------- 列表 ----------
        void RefreshList()
        {
            list.BeginUpdate();
            list.Items.Clear();
            for (int i = 0; i < config.hotkeys.Count; i++)
            {
                HotkeyBinding b = config.hotkeys[i];
                ListViewItem it = new ListViewItem(b.hotkey);
                it.SubItems.Add(b.note.Length > 0 ? b.note : ("#" + b.songId));
                it.SubItems.Add(HotkeyApi.Humanize(b.seconds));
                bool ok;
                string st = "待命";
                if (paused) st = "已暂停";
                else if (registered.TryGetValue(i, out ok) && !ok) st = "热键没注册上";
                it.SubItems.Add(st);
                it.Tag = i;
                if (!paused && registered.ContainsKey(i) && !registered[i]) it.ForeColor = Color.Firebrick;
                list.Items.Add(it);
            }
            list.EndUpdate();
            UpdateTooltip();
        }

        void UpdateTooltip()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("网易云一键播放热键");
            for (int i = 0; i < config.hotkeys.Count && i < 6; i++)
            {
                HotkeyBinding b = config.hotkeys[i];
                sb.Append("\n" + b.hotkey + " → " + (b.note.Length > 0 ? b.note : b.songId) + " @ " + HotkeyApi.Humanize(b.seconds));
            }
            string tip = sb.ToString();
            tray.Text = tip.Length > 62 ? tip.Substring(0, 62) : tip;
        }

        int SelectedIndex()
        {
            if (list.SelectedItems.Count == 0) return -1;
            return (int)list.SelectedItems[0].Tag;
        }

        void AddBinding()
        {
            BindingDialog dlg = new BindingDialog(null, worker, config.port);
            if (dlg.ShowDialog(this) == DialogResult.OK)
            {
                config.hotkeys.Add(dlg.Result);
                SaveConfig();
                RegisterAll();
                FillNote(dlg.Result);
                RefreshList();
            }
        }

        void EditSelected()
        {
            int i = SelectedIndex();
            if (i < 0) { MessageBox.Show(this, "先在列表里选中一行。", "还没选", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            BindingDialog dlg = new BindingDialog(config.hotkeys[i], worker, config.port);
            if (dlg.ShowDialog(this) == DialogResult.OK)
            {
                config.hotkeys[i] = dlg.Result;
                SaveConfig();
                RegisterAll();
                FillNote(dlg.Result);
                RefreshList();
            }
        }

        void DeleteSelected()
        {
            int i = SelectedIndex();
            if (i < 0) { MessageBox.Show(this, "先在列表里选中一行。", "还没选", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            if (MessageBox.Show(this, "确定删掉「" + config.hotkeys[i].hotkey + "」这条吗？", "确认删除",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            config.hotkeys.RemoveAt(i);
            SaveConfig();
            RegisterAll();
            RefreshList();
        }

        void TestSelected()
        {
            int i = SelectedIndex();
            if (i < 0) { MessageBox.Show(this, "先在列表里选中一行。", "还没选", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            Play(i);
        }

        // ---------- 工作进程 ----------
        void ResolveNode()
        {
            nodeExe = RuntimePaths.FindNode(appDir);
        }

        void ResolveCloudMusic()
        {
            try
            {
                string hint = Path.Combine(appDir, "cloudmusic.txt");
                if (File.Exists(hint))
                {
                    string configured = File.ReadAllText(hint).Trim().Trim('"');
                    if (File.Exists(configured)) { cloudMusicPath = configured; return; }
                }
            }
            catch { }
            // Microsoft Store 版本不一定有普通安装器的注册表项。
            foreach (Process process in Process.GetProcessesByName("cloudmusic"))
            {
                try
                {
                    string running = process.MainModule.FileName;
                    if (File.Exists(running))
                    {
                        cloudMusicPath = running;
                        try { File.WriteAllText(Path.Combine(appDir, "cloudmusic.txt"), running, new UTF8Encoding(false)); }
                        catch { }
                        return;
                    }
                }
                catch { }
                finally { process.Dispose(); }
            }
            string[] guesses = new string[]
            {
                @"D:\CloudMusic\cloudmusic.exe",
                @"C:\Program Files\Netease\CloudMusic\cloudmusic.exe",
                @"C:\Program Files (x86)\Netease\CloudMusic\cloudmusic.exe"
            };
            foreach (string g in guesses) if (File.Exists(g)) { cloudMusicPath = g; return; }

            try
            {
                using (RegistryKey k = Registry.LocalMachine.OpenSubKey(
                    @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\CloudMusic"))
                {
                    if (k != null)
                    {
                        object icon = k.GetValue("DisplayIcon");
                        if (icon != null)
                        {
                            string s = icon.ToString().Trim('"').Split(',')[0];
                            if (File.Exists(s)) { cloudMusicPath = s; return; }
                        }
                    }
                }
            }
            catch { }
        }

        void StartWorker()
        {
            ResolveNode();
            if (string.IsNullOrEmpty(nodeExe))
            {
                string error = "找不到播放运行时，请完整解压新版程序包（需包含 runtime\\node.exe）";
                SetStatus(error);
                Log(error);
                return;
            }
            string script = Path.Combine(appDir, "worker.mjs");
            if (!File.Exists(script))
            {
                SetStatus("找不到 worker.mjs，程序装得不完整");
                return;
            }
            try
            {
                worker.Start(nodeExe, script, appDir);
            }
            catch (Exception ex)
            {
                // 不弹对话框（保持静默），只写状态栏和日志
                SetStatus("启动播放服务失败：" + ex.Message + "（请检查 runtime 目录是否解压完整）");
                Log("启动播放服务失败：" + ex.Message + "；运行时=" + nodeExe);
            }
        }

        void Ping()
        {
            if (busyCount > 0) return;
            if (!worker.Running)
            {
                StartWorker();
                if (!worker.Running) return;
            }
            worker.Send(new Dictionary<string, object> { { "cmd", "status" }, { "port", config.port } },
                delegate(Dictionary<string, object> r)
                {
                    Ui(delegate
                    {
                        if (busyCount > 0) return;
                        bool ok = r.ContainsKey("ok") && r["ok"] is bool && (bool)r["ok"];
                        if (!ok)
                        {
                            SetStatus("没连上网易云 —— 请先点「启动网易云」按钮，或从桌面快捷方式「网易云音乐(带热键)」打开");
                            return;
                        }
                        string msg = "已连上网易云（端口 " + config.port + "）";
                        string now = Str(r, "name");
                        if (now.Length > 0) msg += " · 正在放：" + now;
                        bool sus = r.ContainsKey("suspended") && r["suspended"] is bool && (bool)r["suspended"];
                        if (sus)
                        {
                            string sn = Str(r, "savedName");
                            double sa = Num(r, "savedAt");
                            restoreHint = sn;
                            msg += "　｜　中断点：" + sn + " @ " + HotkeyApi.Humanize(sa);
                        }
                        else restoreHint = "";
                        SetStatus(msg);
                        restoreItem.Enabled = config.clipMode && !restorePending;
                        restoreItem.Text = sus ? "复位到中断位置（" + Str(r, "savedName") + "）" : "复位到中断位置";
                        if (!titlesFilled) { titlesFilled = true; FillTitles(); }
                    });
                });
        }

        // 配置文件里只存歌曲 ID。等连上客户端后补一次歌名，列表和托盘提示才看得懂。
        void FillTitles()
        {
            for (int i = 0; i < config.hotkeys.Count; i++)
            {
                if (config.hotkeys[i].note.Length > 0) continue;
                int idx = i;
                worker.Send(new Dictionary<string, object> {
                        { "cmd", "info" },
                        { "songId", config.hotkeys[idx].songId },
                        { "port", config.port } },
                    delegate(Dictionary<string, object> r)
                    {
                        Ui(delegate
                        {
                            bool ok = r.ContainsKey("ok") && r["ok"] is bool && (bool)r["ok"];
                            if (!ok) return;
                            string name = Str(r, "name");
                            if (name.Length == 0) return;
                            string artists = Str(r, "artists");
                            config.hotkeys[idx].note = artists.Length > 0 ? name + " / " + artists : name;
                            SaveConfig();
                            RefreshList();
                        });
                    });
            }
        }

        void LaunchCloudMusic()
        {
            if (cloudMusicPath == null) ResolveCloudMusic();
            string storeAppId = CloudMusicStore.GetAppIdForExecutable(cloudMusicPath);
            if (cloudMusicPath == null) storeAppId = CloudMusicStore.FindInstalledAppId();
            if (cloudMusicPath == null && storeAppId == null)
            {
                MessageBox.Show(this, "找不到 cloudmusic.exe。请手动打开网易云音乐。", "找不到客户端",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            try
            {
                string arguments = "--remote-debugging-port=" + config.port + " --remote-debugging-address=127.0.0.1";
                if (storeAppId != null) CloudMusicStore.Activate(storeAppId, arguments);
                else
                {
                    ProcessStartInfo psi = new ProcessStartInfo(cloudMusicPath);
                    psi.Arguments = arguments;
                    Process process = Process.Start(psi);
                    if (process != null) process.Dispose();
                }
                SetStatus("正在打开网易云…稍等十几秒再按热键");
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "打开网易云失败：\n" + ex.Message, "打开失败",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        void Fire(int index)
        {
            Play(index);
        }

        void Play(int index)
        {
            if (index < 0 || index >= config.hotkeys.Count) return;
            PlaySong(config.hotkeys[index], index);
        }
        void PlaySong(HotkeyBinding b, int index)
        {
            if (restorePending) { Log("复位期间忽略重复播放请求：" + b.songId); return; }
            if (playPending) { Log("已有播放请求处理中，忽略重复触发：" + b.songId); return; }
            if (!worker.Running) { StartWorker(); if (!worker.Running) return; }

            playPending = true;
            busyCount++;
            SetRowStatus(index, "正在播放…");
            SetStatus("正在播放「" + (b.note.Length > 0 ? b.note : b.songId) + "」…");

            Dictionary<string, object> cmd = new Dictionary<string, object>();
            cmd["cmd"] = "play";
            cmd["songId"] = b.songId;
            cmd["seconds"] = b.seconds > 0 ? (object)b.seconds : null;
            cmd["port"] = config.port;
            cmd["awooPort"] = config.awooPort;

            worker.Send(cmd, delegate(Dictionary<string, object> r)
            {
                Ui(delegate
                {
                    playPending = false;
                    busyCount = Math.Max(0, busyCount - 1);
                    bool ok = r.ContainsKey("ok") && r["ok"] is bool && (bool)r["ok"];
                    if (ok)
                    {
                        string name = Str(r, "name");
                        Log("播放成功：songId=" + b.songId + " / " + name);
                        double err = Num(r, "error");
                        double heard = Num(r, "heard");
                        string heardTip = heard > 0.25
                            ? "，切歌到按住用了 " + heard.ToString("0.00", CultureInfo.InvariantCulture) + " 秒"
                            : "";
                        SetRowStatus(index, "✔ 已从 " + HotkeyApi.Humanize(b.seconds) + " 播放");
                        SetStatus("已在播放：" + name + "（起始 " + HotkeyApi.Humanize(b.seconds) + "，误差 " +
                            err.ToString("0.00", CultureInfo.InvariantCulture) + " 秒" + heardTip + "）");
                        Notify("已开始播放", name + " · " + HotkeyApi.Humanize(b.seconds));
                        FillNoteFromResult(index, name, Str(r, "artists"));
                    }
                    else
                    {
                        string err = Str(r, "error");
                        Log("播放失败：songId=" + b.songId + " / " + err);
                        SetRowStatus(index, "✘ 失败");
                        SetStatus("失败：" + err);
                        Notify("播放失败", err);
                    }
                    RefreshList();
                });
            }, 30000);
        }

        void FillNote(HotkeyBinding b)
        {
            worker.Send(new Dictionary<string, object> { { "cmd", "info" }, { "songId", b.songId }, { "port", config.port } },
                delegate(Dictionary<string, object> r)
                {
                    if (!(r.ContainsKey("ok") && r["ok"] is bool && (bool)r["ok"])) return;
                    string name = Str(r, "name");
                    string artists = Str(r, "artists");
                    string text = name + (artists.Length > 0 ? " / " + artists : "");
                    if (!NameCacheSet(b.songId, text)) return;
                    Ui(delegate
                    {
                        if (b.note.Length == 0) b.note = text;
                        SaveConfig();
                        RefreshList();
                    });
                });
        }

        static readonly Dictionary<string, string> Cache = new Dictionary<string, string>();
        static bool NameCacheSet(string id, string text)
        {
            if (Cache.ContainsKey(id) && Cache[id] == text) return false;
            Cache[id] = text;
            return true;
        }

        void FillNoteFromResult(int index, string name, string artists)
        {
            if (index < 0 || index >= config.hotkeys.Count) return;
            HotkeyBinding b = config.hotkeys[index];
            if (b.note.Length > 0) return;
            b.note = name + (artists.Length > 0 ? " / " + artists : "");
            SaveConfig();
        }

        void SetRowStatus(int index, string text)
        {
            foreach (ListViewItem it in list.Items)
            {
                if ((int)it.Tag == index && it.SubItems.Count > 3)
                {
                    it.SubItems[3].Text = text;
                    break;
                }
            }
        }

        public static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v) && v != null) return v.ToString();
            return "";
        }

        public static double Num(Dictionary<string, object> d, string key)
        {
            double r;
            object v;
            if (d != null && d.TryGetValue(key, out v) && v != null &&
                double.TryParse(v.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out r)) return r;
            return 0;
        }

        public static string DurationText(double seconds)
        {
            if (seconds <= 0) return "";
            int t = (int)Math.Round(seconds);
            return string.Format(CultureInfo.InvariantCulture, "{0}:{1:00}", t / 60, t % 60);
        }

        void Notify(string title, string text)
        {
            // 默认静默：不弹任何 Windows 气泡通知，结果只进状态栏和日志。
            // 想要气泡就把 config.json 里的 "notify" 改成 true。
            if (!config.notify) return;
            try
            {
                tray.BalloonTipTitle = title;
                tray.BalloonTipText = text.Length > 200 ? text.Substring(0, 200) : text;
                tray.ShowBalloonTip(3000);
            }
            catch { }
        }

        void SetStatus(string text)
        {
            if (restorePending && text != "正在复位…") return;
            statusLabel.Text = text;
        }

        /// <summary>把一段界面操作切回界面线程执行（Node 的回调跑在后台线程上）。</summary>
        void Ui(MethodInvoker action)
        {
            if (IsDisposed) return;
            try
            {
                if (InvokeRequired) BeginInvoke(action);
                else action();
            }
            catch { }
        }

        void OnWorkerLog(string line)
        {
            // Node 侧日志：只写文件，避免刷屏
            Log(line);
        }

        /// <summary>写一行到 logs\app.log（失败就算了）。</summary>
        void Log(string line)
        {
            try
            {
                string dir = Path.Combine(appDir, "logs");
                Directory.CreateDirectory(dir);
                File.AppendAllText(Path.Combine(dir, "app.log"),
                    DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss.fff") + "  " + line + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
        }

        // ---------- 托盘与退出 ----------
        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!exiting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                ShowInTaskbar = false;
                if (!trayTipShown)
                {
                    trayTipShown = true;
                    Notify("程序还在后台运行", "热键依然有效。要退出请右键点右下角的图标选「退出」。");
                }
                return;
            }
            UnregisterAll();
            if (gameEvents != null) { gameEvents.Dispose(); gameEvents = null; }
            pingTimer.Stop(); pingTimer.Dispose();
            worker.Dispose();
            tray.Visible = false;
            base.OnFormClosing(e);
        }

        void ExitApp()
        {
            exiting = true;
            Close();
        }
    }

    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool hidden = false;
            if (args != null)
                foreach (string a in args)
                    if (a == "--tray" || a == "--silent" || a == "-t") hidden = true;
            Application.Run(new MainForm(hidden));
        }
    }
}
