using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using NcmHotkey;

class WorkerRegressionTests
{
    static int checks;
    static void Check(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
        checks++;
    }

    static Dictionary<string, object> Send(PlayWorker worker, string command)
    {
        Dictionary<string, object> reply = null;
        using (ManualResetEvent done = new ManualResetEvent(false))
        {
            worker.Send(new Dictionary<string, object> { { "cmd", command } }, delegate(Dictionary<string, object> value)
            { reply = value; done.Set(); });
            Check(done.WaitOne(5000), "Callback timed out: " + command);
        }
        return reply;
    }

    static bool Ok(Dictionary<string, object> reply) { return reply.ContainsKey("ok") && (bool)reply["ok"]; }

    static void Parses(string text, uint expectedModifiers, uint expectedKey)
    {
        uint modifiers, key; string error;
        Check(HotkeyApi.Parse(text, out modifiers, out key, out error) &&
            modifiers == expectedModifiers && key == expectedKey, "Incorrect hotkey: " + text + " (" + error + ")");
    }

    static void Rejects(string text)
    {
        uint modifiers, key; string error;
        Check(!HotkeyApi.Parse(text, out modifiers, out key, out error), "Invalid hotkey was accepted: " + text);
    }

    static void CheckSearchDisplay(Dictionary<string, object> response, int expectedRows, string expectedStatus)
    {
        using (BindingDialog dialog = new BindingDialog(null, null, 9229))
        {
            typeof(BindingDialog).GetMethod("ApplySearchResults", BindingFlags.Instance | BindingFlags.NonPublic)
                .Invoke(dialog, new object[] { response });
            ListView results = (ListView)typeof(BindingDialog).GetField("results", BindingFlags.Instance | BindingFlags.NonPublic)
                .GetValue(dialog);
            Label status = (Label)typeof(BindingDialog).GetField("selected", BindingFlags.Instance | BindingFlags.NonPublic)
                .GetValue(dialog);
            Check(results.Items.Count == expectedRows, "Search display row count mismatch: " + results.Items.Count);
            Check(status.Text.Contains(expectedStatus), "Search display status mismatch: " + status.Text);
            if (expectedRows > 0)
            {
                Check(results.Items[0].Text == "雨爱 (DJ版)" && (string)results.Items[0].Tag == "3362244118",
                    "Song title and ID must survive worker-to-dialog deserialization");
                Check(results.Items[0].SubItems[1].Text == "DYYL." && results.Items[0].SubItems[3].Text == "3:45",
                    "Search artist and duration must be displayed");
            }
        }
    }

    [STAThread]
    static int Main(string[] args)
    {
        System.Text.Encoding originalInput = null;
        try
        {
            if (args.Length > 3 && args[3] == "--utf8-console")
            {
                originalInput = Console.InputEncoding;
                Console.InputEncoding = new System.Text.UTF8Encoding(true);
            }
            var search = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                "{\"ok\":true,\"list\":[{\"id\":\"3362244118\",\"name\":\"雨爱 (DJ版)\",\"artists\":\"DYYL.\",\"duration\":225}," +
                "{\"id\":\"316100\",\"name\":\"雨爱\",\"artists\":\"杨丞琳\",\"duration\":260}]}");
            Check(search["list"] is System.Collections.ArrayList, "Test must reproduce the actual serializer collection type");
            CheckSearchDisplay(search, 2, "共 2 首");
            var searchRows = (System.Collections.ArrayList)search["list"];
            search["list"] = searchRows.ToArray();
            CheckSearchDisplay(search, 2, "共 2 首");
            search["list"] = new object[0];
            CheckSearchDisplay(search, 0, "没搜到");
            search["list"] = "invalid payload";
            CheckSearchDisplay(search, 0, "格式异常");
            CheckSearchDisplay(new Dictionary<string, object> { { "ok", false }, { "error", "网络连接超时" } }, 0, "网络连接超时");
            Parses("Oemplus", 0, 0xBB);
            Parses("Ctrl+oEmPlUs", HotkeyApi.MOD_CONTROL, 0xBB);
            Parses("+", 0, 0xBB);
            Parses("Ctrl++", HotkeyApi.MOD_CONTROL, 0xBB);
            Parses("Ctrl+Shift++", HotkeyApi.MOD_CONTROL | HotkeyApi.MOD_SHIFT, 0xBB);
            Parses("=", 0, 0xBB);
            Parses("OemMinus", 0, 0xBD);
            Parses("Ctrl+;", HotkeyApi.MOD_CONTROL, 0xBA);
            Parses("Num0", 0, 0x60);
            Parses("Num9", 0, 0x69);
            Parses("NumPad5", 0, 0x65);
            Parses("Add", 0, 0x6B);
            Parses("Divide", 0, 0x6F);
            Parses("MediaPlayPause", 0, 0xB3);
            Parses("Win+Oemplus", HotkeyApi.MOD_WIN, 0xBB);
            Rejects("Ctrl+");
            Rejects("Ctrl+P+O");
            Rejects("Ctrl+++ ");
            Rejects("Ctrl+NotAKey");
            Rejects("187");
            Rejects("ShiftKey");
            Rejects("LButton");
            Rejects("界");
            // Every key name the recorder emits must be understood by the parser.
            foreach (Keys physical in Enum.GetValues(typeof(Keys)))
            {
                uint value = (uint)physical;
                if (value < 8 || value > 0xFE || HotkeyApi.IsModifierKey(physical)) continue;
                foreach (Keys modifiers in new Keys[] { Keys.None, Keys.Control, Keys.Shift, Keys.Alt,
                    Keys.Control | Keys.Shift | Keys.Alt })
                {
                    uint mask = ((modifiers & Keys.Control) != 0 ? HotkeyApi.MOD_CONTROL : 0) |
                        ((modifiers & Keys.Shift) != 0 ? HotkeyApi.MOD_SHIFT : 0) |
                        ((modifiers & Keys.Alt) != 0 ? HotkeyApi.MOD_ALT : 0);
                    Parses(HotkeyApi.Format(physical | modifiers), mask, value);
                }
            }
            HotkeyMatcher keys = new HotkeyMatcher();
            Check(keys.Add(1, 0, 0x50), "P playback binding must be accepted");
            Check(keys.Add(2, 0, 0x4F), "O restore binding must be accepted");
            Check(!keys.Add(3, 0, 0x50), "Duplicate playback/restore binding must be rejected");
            Check(keys.Observe(0x50, true, 0) == 1, "P first press must trigger playback");
            Check(keys.Observe(0x50, true, 0) == null, "Held P must not repeatedly restart music");
            Check(keys.Observe(0x4F, true, 0) == 2, "O must work while another key is held");
            Check(keys.Observe(0x50, false, 0) == null, "Key release must not trigger music");
            Check(keys.Observe(0x50, true, 0) == 1, "P must trigger again after release");
            keys.Observe(0x50, false, 0);
            Check(keys.Observe(0x50, true, HotkeyApi.MOD_SHIFT) == null, "Shift+P must not trigger plain P");
            keys.Observe(0x50, false, 0);
            Check(keys.Add(4, HotkeyApi.MOD_CONTROL | HotkeyApi.MOD_ALT, 0x50), "A different modifier combination must be accepted");
            Check(keys.Observe(0x50, true, HotkeyApi.MOD_CONTROL | HotkeyApi.MOD_ALT) == 4, "Ctrl+Alt+P must select its own binding");
            Check(keys.Observe(0x50, true, 0) == null, "Changing modifiers while holding P must not retrigger");
            keys.Clear();
            Check(keys.Observe(0x4F, true, 0) == null, "Paused/cleared bindings must not trigger");
            Check(keys.Add(1, 0, 0x50) && keys.Observe(0x50, true, 0) == 1, "Resume must start with clean key state");
            using (PassiveHotkeys listener = new PassiveHotkeys())
            {
                listener.Add(1, 0, 0x50);
                listener.Start();
                listener.Dispose();
                listener.Dispose();
                Check(true, "Native passive listener installation/disposal must succeed");
            }
            string node = args[0], script = args[1], workDir = Path.GetDirectoryName(script);
            using (PlayWorker worker = new PlayWorker())
            {
                worker.LogLine += delegate(string line) { Console.Error.WriteLine("worker stderr: " + line); };
                Check(!worker.Running, "New worker must not run");
                // Reproduce the exact original crash without launching anything.
                typeof(PlayWorker).GetField("proc", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(worker, new Process());
                Check(!worker.Running, "Unassociated Process must not make Running throw");
                Check(!Ok(Send(worker, "ping")), "Unassociated Process must report an error");
                bool failed = false;
                try { worker.Start(Path.Combine(workDir, "missing-runtime.exe"), script, workDir); }
                catch (System.ComponentModel.Win32Exception) { failed = true; }
                Check(failed && !worker.Running, "Failed Start must not publish a Process");
                Check(!Ok(Send(worker, "ping")), "Send after failed Start must not throw");
                worker.Start(node, script, workDir);
                Check(worker.Running, "Worker process exited immediately after recovery Start");
                Dictionary<string, object> recovery = Send(worker, "ping");
                Check(Ok(recovery), "A worker must recover after failed Start: " + new JavaScriptSerializer().Serialize(recovery));
                string unicode = "雨爱 DJ版 杨丞琳 🎵";
                Dictionary<string, object> unicodeReply = Send(worker, unicode);
                Check(Ok(unicodeReply) && (string)unicodeReply["echo"] == unicode,
                    "Chinese and Unicode search text must survive the C# -> Node -> C# UTF-8 round trip");
                Check(Ok(Send(worker, "malformed")), "Malformed output must not break a later valid reply");

                int duplicateCallbacks = 0;
                using (ManualResetEvent duplicateDone = new ManualResetEvent(false))
                {
                    worker.Send(new Dictionary<string, object> { { "cmd", "duplicate" } }, delegate(Dictionary<string, object> reply)
                    { Interlocked.Increment(ref duplicateCallbacks); duplicateDone.Set(); });
                    Check(duplicateDone.WaitOne(5000), "Duplicate test did not reply");
                    Check(Ok(Send(worker, "barrier")), "Worker did not process following command");
                    Check(duplicateCallbacks == 1, "Duplicate reply must complete callback only once");
                }

                Check(!Ok(Send(worker, "exit")), "Unexpected exit must complete pending callback with an error");
                Check(!worker.Running, "Exited worker must not run");
                worker.Start(node, script, workDir);
                Check(Ok(Send(worker, "reply-and-exit")), "Final stdout response must precede exit error");
                worker.Start(node, script, workDir);

                int completions = 0;
                using (ManualResetEvent disposed = new ManualResetEvent(false))
                {
                    worker.Send(new Dictionary<string, object> { { "cmd", "hang" } }, delegate(Dictionary<string, object> reply)
                    { Check(!Ok(reply), "Dispose must report an error"); Interlocked.Increment(ref completions); disposed.Set(); });
                    worker.Dispose();
                    worker.Dispose();
                    Check(disposed.WaitOne(5000) && completions == 1, "Dispose must finish callback once");
                }
                Check(!worker.Running, "Dispose must clear Process");
            }

            string testRoot = Path.Combine(Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location),
                "runtime-path-" + Guid.NewGuid().ToString("N"));
            string bundled = Path.Combine(testRoot, "runtime");
            Directory.CreateDirectory(bundled);
            File.WriteAllText(Path.Combine(bundled, "node.exe"), "resolver fixture only");
            File.WriteAllText(Path.Combine(testRoot, "node.txt"), @"Z:\missing-runtime.exe");
            Check(RuntimePaths.FindNode(testRoot) == Path.Combine(bundled, "node.exe"), "Bundled runtime must win over stale node.txt");
            string configured = Path.Combine(testRoot, "configured");
            Directory.CreateDirectory(configured);
            File.WriteAllText(Path.Combine(configured, "node.txt"), "\"" + node + "\"");
            Check(RuntimePaths.FindNode(configured) == node, "Quoted configured runtime must resolve");
            string packageRoot = Path.Combine(testRoot, "1F8B0F94.122165AE053F_3.1.23.0_x64__j2p0p5q0044a6");
            Directory.CreateDirectory(packageRoot);
            string packagedExe = Path.Combine(packageRoot, @"VFS\ProgramFilesX86\Netease\CloudMusic\cloudmusic.exe");
            Directory.CreateDirectory(Path.GetDirectoryName(packagedExe));
            File.WriteAllText(packagedExe, "package fixture only");
            File.WriteAllText(Path.Combine(packageRoot, "AppxManifest.xml"),
                "<Package xmlns=\"http://schemas.microsoft.com/appx/manifest/foundation/windows10\"><Applications>" +
                "<Application Id=\"OTHER\" Executable=\"other.exe\"/>" +
                "<Application Id=\"CLOUDMUSIC\" Executable=\"VFS\\ProgramFilesX86\\Netease\\CloudMusic\\cloudmusic.exe\"/>" +
                "</Applications></Package>");
            Check(CloudMusicStore.GetAppIdForExecutable(packagedExe) == "1F8B0F94.122165AE053F_j2p0p5q0044a6!CLOUDMUSIC",
                "Store app identity must match the executable, not the first application");
            Check(CloudMusicStore.GetAppIdForExecutable(Path.Combine(packageRoot, "unrelated.exe")) == null,
                "Unrelated executable must not use Store activation");
            Check(CloudMusicStore.GetAppIdForExecutable(node) == null, "Ordinary executable must not use Store activation");
            Check(CloudMusicStore.GetAppIdForExecutable(null) == null, "Missing executable must be supported");
            if (args.Length > 2)
            {
                using (PlayWorker worker = new PlayWorker())
                {
                    worker.Start(node, args[2], Path.GetDirectoryName(args[2]));
                    Dictionary<string, object> reply = Send(worker, "ping");
                    Check(Ok(reply) && reply.ContainsKey("ready"), "Real playback worker did not reply to ping");
                }
            }
            Console.WriteLine("PASS: " + checks + " checks (search result display, passive hotkeys, worker lifecycle, runtime and Store resolution)");
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
        finally { if (originalInput != null) Console.InputEncoding = originalInput; }
    }
}
