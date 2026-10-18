using System;
using System.Collections.Generic;
using System.Drawing;
using System.Windows.Forms;

namespace NcmHotkey
{
    public sealed class GameEventRuleDialog : Form
    {
        readonly CheckBox p1 = new CheckBox(), p2 = new CheckBox(), enabled = new CheckBox();
        readonly NumericUpDown delay = new NumericUpDown();
        readonly Label songLabel = new Label();
        HotkeyBinding song;
        readonly GameEventRule original;
        public GameEventRule Result { get; private set; }
        public GameEventRuleDialog(GameEventRule rule, IList<HotkeyBinding> hotkeys, PlayWorker worker, int port)
        {
            original = rule == null ? new GameEventRule() : rule.Clone();
            song = rule != null ? rule.Song() : hotkeys.Count > 0 ? hotkeys[0].Clone() : new HotkeyBinding();
            Text = rule == null ? "添加游戏事件规则" : "编辑游戏事件规则";
            Font = new Font("Microsoft YaHei UI", 9F); ClientSize = new Size(630, 355);
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterParent;
            Label game = LabelAt("游　戏", 16, 20, 80);
            ComboBox gameBox = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Location = new Point(105, 16), Size = new Size(340, 26) };
            gameBox.Items.Add(GameEventCatalog.GameName(original.game)); gameBox.SelectedIndex = 0;
            Label eventLabel = LabelAt("事　件", 16, 62, 80);
            ComboBox eventBox = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Location = new Point(105, 58), Size = new Size(340, 26) };
            eventBox.Items.Add(GameEventCatalog.EventName(original.eventId)); eventBox.SelectedIndex = 0;
            Label side = LabelAt("监听角色", 16, 104, 80);
            p1.Text = "1P"; p1.SetBounds(105, 100, 80, 26); p1.Checked = (original.playerSlots & 1) != 0;
            p2.Text = "2P"; p2.SetBounds(195, 100, 80, 26); p2.Checked = (original.playerSlots & 2) != 0;
            Label slots = LabelAt("可同时勾选；按开局角色槽位区分，换边后不变。", 105, 130, 505); slots.ForeColor = Color.Gray;
            Label songTitle = LabelAt("播放歌曲", 16, 170, 80);
            songLabel.SetBounds(105, 165, 390, 28); songLabel.AutoEllipsis = true;
            Button pick = new Button { Text = "选择歌曲…", Location = new Point(500, 161), Size = new Size(112, 30) };
            pick.Click += delegate {
                using (BindingDialog dialog = new BindingDialog(song, worker, port, true))
                    if (dialog.ShowDialog(this) == DialogResult.OK) { song = dialog.Result; UpdateSong(); }
            };
            Label delayLabel = LabelAt("触发后延迟", 16, 211, 85);
            delay.SetBounds(105, 206, 95, 26); delay.DecimalPlaces = 2; delay.Increment = .1m; delay.Maximum = 30;
            double value = original.delaySeconds;
            delay.Value = double.IsNaN(value) || double.IsInfinity(value) ? .4m : (decimal)Math.Max(0, Math.Min(30, value));
            Label delayHint = LabelAt("秒；网易云切歌、加载还需要额外时间。", 210, 211, 400); delayHint.ForeColor = Color.Gray;
            enabled.Text = "启用这条规则"; enabled.Checked = original.enabled; enabled.SetBounds(105, 247, 200, 25);
            Button ok = new Button { Text = "确定", Location = new Point(414, 302), Size = new Size(94, 32) };
            ok.Click += delegate {
                GameEventRule result = original.Clone(); result.enabled = enabled.Checked;
                result.playerSlots = (p1.Checked ? 1 : 0) | (p2.Checked ? 2 : 0);
                result.songId = song.songId; result.seconds = song.seconds; result.note = song.note;
                result.delaySeconds = (double)delay.Value;
                string error = GameEventCatalog.Validate(result);
                if (error != null) { MessageBox.Show(this, error, "规则未完成", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
                Result = result; DialogResult = DialogResult.OK; Close();
            };
            Button cancel = new Button { Text = "取消", Location = new Point(518, 302), Size = new Size(94, 32), DialogResult = DialogResult.Cancel };
            Controls.AddRange(new Control[] { game, gameBox, eventLabel, eventBox, side, p1, p2, slots,
                songTitle, songLabel, pick, delayLabel, delay, delayHint, enabled, ok, cancel });
            AcceptButton = ok; CancelButton = cancel; UpdateSong();
        }
        static Label LabelAt(string text, int x, int y, int width) { return new Label { Text = text, Location = new Point(x, y), Size = new Size(width, 22) }; }
        void UpdateSong()
        {
            songLabel.Text = string.IsNullOrEmpty(song.songId) ? "尚未选择歌曲" :
                (string.IsNullOrEmpty(song.note) ? "ID " + song.songId : song.note) + " · 从 " + HotkeyApi.Humanize(song.seconds) + " 开始";
        }
    }

    public sealed class GameEventsDialog : Form
    {
        readonly ListView list = new ListView();
        readonly CheckBox master = new CheckBox();
        readonly Label monitoringStatus = new Label();
        readonly ToolTip monitoringTip = new ToolTip();
        readonly List<GameEventRule> rules = new List<GameEventRule>();
        readonly IList<HotkeyBinding> hotkeys;
        readonly PlayWorker worker;
        readonly int port;
        bool refreshing;
        public List<GameEventRule> Result { get; private set; }
        public bool MonitoringEnabled { get { return master.Checked; } }
        public GameEventsDialog(bool on, IEnumerable<GameEventRule> values, IList<HotkeyBinding> hotkeys, PlayWorker worker, int port)
        {
            this.hotkeys = hotkeys; this.worker = worker; this.port = port;
            foreach (GameEventRule r in values) if (r != null) rules.Add(r.Clone());
            Text = "监听游戏事件（实验）"; Font = new Font("Microsoft YaHei UI", 9F);
            ClientSize = new Size(875, 505); MinimumSize = new Size(760, 470); StartPosition = FormStartPosition.CenterParent;
            master.Text = "启用游戏事件监听"; master.Checked = on; master.SetBounds(15, 15, 235, 26);
            Label hint = new Label { Text = "目前支持 GGST 凯发动龙装。训练场已验证；联网待验证，暂需手动勾选 1P / 2P。",
                Location = new Point(15, 48), Size = new Size(845, 28), Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right, ForeColor = Color.DarkGoldenrod };
            list.SetBounds(15, 83, 845, 245); list.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            list.View = View.Details; list.FullRowSelect = true; list.MultiSelect = false; list.CheckBoxes = true; list.HideSelection = false;
            list.Columns.Add("启用 / 游戏", 160); list.Columns.Add("事件", 140); list.Columns.Add("监听角色", 90);
            list.Columns.Add("播放歌曲", 235); list.Columns.Add("起点", 75); list.Columns.Add("延迟", 75);
            list.DoubleClick += delegate { Edit(); };
            list.ItemCheck += delegate(object sender, ItemCheckEventArgs e) {
                if (refreshing) return;
                GameEventRule r = rules[e.Index].Clone(); r.enabled = e.NewValue == CheckState.Checked;
                string error = r.enabled ? GameEventCatalog.Validate(r) ?? GameEventCatalog.Conflict(r, rules) : null;
                if (error != null) { e.NewValue = e.CurrentValue; MessageBox.Show(this, error, "无法启用", MessageBoxButtons.OK, MessageBoxIcon.Information); }
                else rules[e.Index].enabled = r.enabled;
            };
            Button add = ButtonAt("添加规则", 15, delegate { Add(); });
            Button edit = ButtonAt("编辑", 125, delegate { Edit(); });
            Button remove = ButtonAt("删除", 235, delegate { int index = Selected(); if (index >= 0) { rules.RemoveAt(index); RefreshRules(); } });
            GroupBox monitoring = new GroupBox { Text = "实时游戏状态", Location = new Point(15, 338), Size = new Size(845, 72),
                Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right, Padding = new Padding(10, 3, 10, 6) };
            monitoringStatus.Dock = DockStyle.Fill; monitoringStatus.TextAlign = ContentAlignment.MiddleLeft;
            monitoringStatus.AutoEllipsis = true; monitoring.Controls.Add(monitoringStatus);
            UpdateMonitoringStatus("游戏事件：未启用");
            Label tip = new Label { Text = "状态按已保存的规则刷新。此窗口打开期间暂停自动切歌，保存或取消后恢复。",
                Location = new Point(15, 467), Size = new Size(845, 32), Anchor = AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right, ForeColor = Color.Gray };
            Button save = new Button { Text = "保存", Location = new Point(660, 425), Size = new Size(94, 32), Anchor = AnchorStyles.Bottom | AnchorStyles.Right };
            save.Click += delegate {
                Result = new List<GameEventRule>(); foreach (GameEventRule r in rules) Result.Add(r.Clone());
                DialogResult = DialogResult.OK; Close();
            };
            Button cancel = new Button { Text = "取消", Location = new Point(766, 425), Size = new Size(94, 32), Anchor = AnchorStyles.Bottom | AnchorStyles.Right, DialogResult = DialogResult.Cancel };
            Controls.AddRange(new Control[] { master, hint, list, monitoring, add, edit, remove, save, cancel, tip });
            AcceptButton = save; CancelButton = cancel; RefreshRules();
        }
        Button ButtonAt(string text, int x, EventHandler action)
        {
            Button b = new Button { Text = text, Location = new Point(x, 425), Size = new Size(100, 32), Anchor = AnchorStyles.Bottom | AnchorStyles.Left };
            b.Click += action; return b;
        }
        public void UpdateMonitoringStatus(string text)
        {
            monitoringStatus.Text = text ?? "";
            monitoringTip.SetToolTip(monitoringStatus, monitoringStatus.Text);
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing) monitoringTip.Dispose();
            base.Dispose(disposing);
        }
        int Selected() { return list.SelectedIndices.Count == 0 ? -1 : list.SelectedIndices[0]; }
        void RefreshRules()
        {
            refreshing = true; list.BeginUpdate(); list.Items.Clear();
            foreach (GameEventRule r in rules) {
                ListViewItem item = new ListViewItem(GameEventCatalog.GameName(r.game)); item.Checked = r.enabled;
                item.SubItems.Add(GameEventCatalog.EventName(r.eventId)); item.SubItems.Add(GameEventCatalog.Slots(r.playerSlots));
                item.SubItems.Add(string.IsNullOrEmpty(r.note) ? "ID " + r.songId : r.note); item.SubItems.Add(HotkeyApi.Humanize(r.seconds));
                item.SubItems.Add(r.delaySeconds.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + " 秒"); list.Items.Add(item);
            }
            list.EndUpdate(); refreshing = false;
        }
        void Add()
        {
            using (GameEventRuleDialog dialog = new GameEventRuleDialog(null, hotkeys, worker, port))
                if (dialog.ShowDialog(this) == DialogResult.OK && Accept(dialog.Result)) { rules.Add(dialog.Result); RefreshRules(); }
        }
        void Edit()
        {
            int index = Selected(); if (index < 0) return;
            using (GameEventRuleDialog dialog = new GameEventRuleDialog(rules[index], hotkeys, worker, port))
                if (dialog.ShowDialog(this) == DialogResult.OK && Accept(dialog.Result)) { rules[index] = dialog.Result; RefreshRules(); }
        }
        bool Accept(GameEventRule rule)
        {
            string error = GameEventCatalog.Conflict(rule, rules);
            if (error == null) return true;
            MessageBox.Show(this, error, "规则重叠", MessageBoxButtons.OK, MessageBoxIcon.Information); return false;
        }
    }
}
