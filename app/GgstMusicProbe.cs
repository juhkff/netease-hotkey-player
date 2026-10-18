// Local experiment only. Build separately with /main:NcmHotkey.GgstProbeProgram.
// The existing application and release build do not include this file.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace NcmHotkey
{
    public sealed class GgstProbeForm : Form
    {
        readonly string root = AppDomain.CurrentDomain.BaseDirectory;
        readonly PlayWorker worker = new PlayWorker();
        readonly DragonEntryGate gate = new DragonEntryGate();
        readonly Stopwatch clock = Stopwatch.StartNew();
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
        readonly Label state = new Label(), client = new Label();
        readonly CheckBox armed = new CheckBox();
        readonly ComboBox side = new ComboBox();
        readonly TextBox log = new TextBox();
        readonly object logLock = new object();
        volatile bool closing;
        int connecting;
        GgstReadOnly reader;
        string lastState = "", lastError = "";
        double reconnectAt;
        bool playing;
        public GgstProbeForm()
        {
            Text = "GGST → 网易云 · 本地可行性验证（未提交）";
            ClientSize = new Size(770, 440); StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Microsoft YaHei UI", 9);
            Label warning = new Label { Text = "实验版：当前需手动选择 1P / 2P，尚未自动识别联网操控方。只读游戏，不拦截按键。", Location = new Point(15, 15), Size = new Size(740, 24), ForeColor = Color.DarkRed };
            side.SetBounds(15, 50, 170, 28); side.DropDownStyle = ComboBoxStyle.DropDownList;
            side.Items.AddRange(new object[] { "监听 1P 角色槽位", "监听 2P 角色槽位" }); side.SelectedIndex = 0;
            armed.Text = "开启龙装自动播放"; armed.SetBounds(205, 52, 200, 25);
            armed.CheckedChanged += delegate { gate.Reset(); WriteLog(armed.Checked ? "已启用，监听 " + (side.SelectedIndex + 1) + "P" : "已停用自动播放"); };
            side.SelectedIndexChanged += delegate { gate.Reset(); WriteLog("切换监听槽位：" + (side.SelectedIndex + 1) + "P"); };
            Button restore = new Button { Text = "复位网易云", Location = new Point(440, 48), Size = new Size(120, 30) };
            restore.Click += delegate { SendRestore(); };
            Button folder = new Button { Text = "打开实验目录", Location = new Point(580, 48), Size = new Size(145, 30) };
            folder.Click += delegate { Process.Start(root); };
            state.SetBounds(15, 92, 740, 50); state.Text = "正在连接游戏…";
            client.SetBounds(15, 145, 740, 25); client.Text = "正在检查网易云调试端口…";
            Label song = new Label { Text = "目标：DYYL.《雨爱（DJ版）》 / ID 3362244118 / 从头播放 / 触发后延迟 0.4 秒", Location = new Point(15, 175), Size = new Size(740, 25) };
            log.SetBounds(15, 205, 740, 220); log.Multiline = true; log.ReadOnly = true; log.ScrollBars = ScrollBars.Vertical;
            Controls.AddRange(new Control[] { warning, side, armed, restore, folder, state, client, song, log });
            worker.LogLine += delegate(string line) { WriteLog("播放服务：" + line); };
            worker.Start(Path.Combine(root, "runtime", "node.exe"), Path.Combine(root, "worker.mjs"), root);
            worker.Send(new Dictionary<string, object> { { "cmd", "ping" }, { "port", 9229 } }, delegate(Dictionary<string, object> r) {
                Ui(delegate { client.Text = r.ContainsKey("ready") && object.Equals(r["ready"], true) ? "网易云已连接（端口 9229）" : "网易云未连接；请通过原热键软件的“启动网易云”功能连接"; });
            });
            timer.Interval = 20; timer.Tick += delegate { Poll(); }; timer.Start();
            WriteLog("实验启动；自动播放默认关闭；原热键程序和配置保持原状。");
        }
        void Ui(Action action) { if (!closing && !IsDisposed && IsHandleCreated) try { BeginInvoke(action); } catch (InvalidOperationException) { } }
        void WriteLog(string text)
        {
            string line = DateTime.Now.ToString("HH:mm:ss.fff") + " " + text;
            lock (logLock) {
                try { File.AppendAllText(Path.Combine(root, "probe.log"), line + Environment.NewLine, new UTF8Encoding(false)); } catch { }
            }
            Ui(delegate { log.AppendText(line + Environment.NewLine); });
        }
        void Poll()
        {
            if (reader == null) {
                if (clock.Elapsed.TotalSeconds < reconnectAt || Interlocked.CompareExchange(ref connecting, 1, 0) != 0) return;
                ThreadPool.QueueUserWorkItem(delegate {
                    GgstReadOnly attached = null; string error = null;
                    try { attached = GgstReadOnly.Attach(); } catch (Exception e) { error = e.Message; }
                    if (closing) { if (attached != null) attached.Dispose(); Interlocked.Exchange(ref connecting, 0); return; }
                    GgstReadOnly ready = attached; string message = error;
                    Ui(delegate {
                        reader = ready; reconnectAt = clock.Elapsed.TotalSeconds + 3; Interlocked.Exchange(ref connecting, 0);
                        if (ready != null) { gate.Reset(); lastState = ""; WriteLog("已只读连接游戏 PID " + ready.ProcessId); }
                        else { state.Text = message; if (lastError != message) { WriteLog(message); lastError = message; } }
                    });
                });
                return;
            }
            try {
                GgstReadOnly.Snapshot s = reader.Sample();
                string value = "1P：" + s.State[0] + " [" + s.Sprite[0] + "]\r\n2P：" + s.State[1] + " [" + s.Sprite[1] + "]";
                state.Text = value;
                string actions = s.State[0] + " | " + s.State[1];
                if (actions != lastState) { WriteLog("状态 " + actions); lastState = actions; }
                int slot = side.SelectedIndex;
                if (gate.Observe(s.Entity[slot], s.State[slot], s.Sprite[slot], clock.Elapsed.TotalSeconds, armed.Checked)) {
                    WriteLog("DRAGON_TRIGGER slot=" + slot + " state=" + s.State[slot]); PlaySong();
                }
                lastError = "";
            } catch (Exception e) {
                // Never retain a pending song across unreadable data, a menu or a new match.
                gate.Reset(); reader.Dispose(); reader = null; reconnectAt = clock.Elapsed.TotalSeconds + 2;
                state.Text = e.Message;
                if (lastError != e.Message) { WriteLog(e.Message); lastError = e.Message; }
            }
        }
        void PlaySong()
        {
            if (playing) { WriteLog("上次播放请求尚未完成，忽略重复事件"); return; }
            playing = true; client.Text = "龙装已触发，正在播放雨爱（DJ版）…";
            worker.Send(new Dictionary<string, object> { { "cmd", "play" }, { "songId", "3362244118" }, { "seconds", null }, { "port", 9229 } }, delegate(Dictionary<string, object> r) {
                Ui(delegate { playing = false; bool ok = r.ContainsKey("ok") && object.Equals(r["ok"], true);
                    string result = ok ? "网易云已开始播放：" + Convert.ToString(r["name"]) : "播放失败：" + (r.ContainsKey("error") ? Convert.ToString(r["error"]) : "未知错误");
                    client.Text = result; WriteLog(result);
                });
            });
        }
        void SendRestore()
        {
            worker.Send(new Dictionary<string, object> { { "cmd", "restore" }, { "port", 9229 } }, delegate(Dictionary<string, object> r) {
                WriteLog("复位结果：" + new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(r));
            });
        }
        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            closing = true; timer.Stop(); timer.Dispose(); if (reader != null) reader.Dispose(); worker.Dispose(); base.OnFormClosed(e);
        }
    }
    public static class GgstProbeProgram
    {
        [STAThread] public static void Main()
        {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new GgstProbeForm());
        }
    }
}
