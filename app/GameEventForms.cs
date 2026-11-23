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
        readonly ListView songsView = new ListView();
        readonly List<GameEventTrack> tracks = new List<GameEventTrack>();
        readonly PlayWorker worker;
        readonly int port;
        readonly GameEventRule original;
        readonly Action<HotkeyBinding> preview;
        public GameEventRule Result { get; private set; }
        public GameEventRuleDialog(GameEventRule rule, IList<HotkeyBinding> hotkeys, PlayWorker worker, int port)
            : this(rule, hotkeys, worker, port, null) { }
        public GameEventRuleDialog(GameEventRule rule, IList<HotkeyBinding> hotkeys, PlayWorker worker, int port, Action<HotkeyBinding> preview)
        {
            this.worker = worker; this.port = port; this.preview = preview;
            original = rule == null ? new GameEventRule() : rule.Clone();
            foreach (GameEventTrack track in original.Tracks()) tracks.Add(track.Clone());
            if (rule == null && tracks.Count == 0 && hotkeys.Count > 0 && !string.IsNullOrEmpty(hotkeys[0].songId))
                tracks.Add(GameEventTrack.FromBinding(hotkeys[0]));
            Text = rule == null ? "添加游戏事件规则" : "编辑游戏事件规则";
            Font = new Font("Microsoft YaHei UI", 9F); ClientSize = new Size(640, 484);
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
            Label songTitle = LabelAt("播放曲目", 16, 168, 80);
            songsView.SetBounds(105, 164, 395, 140);
            songsView.View = View.Details; songsView.FullRowSelect = true; songsView.MultiSelect = false;
            songsView.HideSelection = false; songsView.ShowItemToolTips = true;
            songsView.Columns.Add("歌曲", 280); songsView.Columns.Add("起点", 90);
            songsView.DoubleClick += delegate { EditTrack(); };
            Button addTrack = new Button { Text = "添加歌曲…", Location = new Point(508, 164), Size = new Size(116, 30) };
            Button editTrack = new Button { Text = "编辑", Location = new Point(508, 202), Size = new Size(116, 30) };
            Button removeTrack = new Button { Text = "删除", Location = new Point(508, 240), Size = new Size(116, 30) };
            Button tryTrack = new Button { Text = "试一下", Location = new Point(508, 278), Size = new Size(116, 30) };
            addTrack.Click += delegate { AddTrack(); };
            editTrack.Click += delegate { EditTrack(); };
            removeTrack.Click += delegate { RemoveTrack(); };
            tryTrack.Click += delegate { TryTrack(); };
            Label songHint = LabelAt("触发时从这些曲目里随机播放一首。每首可以单独设置起点。", 105, 310, 510);
            songHint.ForeColor = Color.Gray;
            Label delayLabel = LabelAt("触发后延迟", 16, 346, 85);
            delay.SetBounds(105, 341, 95, 26); delay.DecimalPlaces = 2; delay.Increment = .1m; delay.Maximum = 30;
            double value = original.delaySeconds;
            delay.Value = double.IsNaN(value) || double.IsInfinity(value) ? .4m : (decimal)Math.Max(0, Math.Min(30, value));
            Label delayHint = LabelAt("秒；网易云切歌、加载还需要额外时间。", 210, 346, 400); delayHint.ForeColor = Color.Gray;
            enabled.Text = "启用这条规则"; enabled.Checked = original.enabled; enabled.SetBounds(105, 384, 200, 25);
            Button ok = new Button { Text = "确定", Location = new Point(414, 432), Size = new Size(94, 32) };
            ok.Click += delegate {
                GameEventRule result = original.Clone(); result.enabled = enabled.Checked;
                result.playerSlots = (p1.Checked ? 1 : 0) | (p2.Checked ? 2 : 0);
                result.delaySeconds = (double)delay.Value;
                result.SetTracks(tracks);
                string error = GameEventCatalog.Validate(result);
                if (error != null) { MessageBox.Show(this, error, "规则未完成", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
                Result = result; DialogResult = DialogResult.OK; Close();
            };
            Button cancel = new Button { Text = "取消", Location = new Point(518, 432), Size = new Size(106, 32), DialogResult = DialogResult.Cancel };
            Controls.AddRange(new Control[] { game, gameBox, eventLabel, eventBox, side, p1, p2, slots,
                songTitle, songsView, addTrack, editTrack, removeTrack, tryTrack, songHint, delayLabel, delay, delayHint, enabled, ok, cancel });
            AcceptButton = ok; CancelButton = cancel; RefreshTracks();
        }
        static Label LabelAt(string text, int x, int y, int width) { return new Label { Text = text, Location = new Point(x, y), Size = new Size(width, 22) }; }
        int SelectedTrack() { return songsView.SelectedIndices.Count == 0 ? -1 : songsView.SelectedIndices[0]; }
        void RefreshTracks()
        {
            int selected = SelectedTrack();
            songsView.BeginUpdate(); songsView.Items.Clear();
            foreach (GameEventTrack track in tracks) {
                ListViewItem item = new ListViewItem(GameEventCatalog.TrackTitle(track));
                item.SubItems.Add(HotkeyApi.Humanize(track.seconds));
                item.ToolTipText = item.Text + " · " + HotkeyApi.Humanize(track.seconds);
                songsView.Items.Add(item);
            }
            songsView.EndUpdate();
            if (tracks.Count == 0) return;
            int index = selected >= 0 && selected < tracks.Count ? selected : 0;
            songsView.Items[index].Selected = true; songsView.Items[index].Focused = true;
        }
        void AddTrack()
        {
            using (BindingDialog dialog = new BindingDialog(null, worker, port, true))
                if (dialog.ShowDialog(this) == DialogResult.OK) {
                    tracks.Add(GameEventTrack.FromBinding(dialog.Result));
                    RefreshTracks();
                    songsView.Items[tracks.Count - 1].Selected = true;
                }
        }
        void EditTrack()
        {
            int index = SelectedTrack(); if (index < 0) return;
            using (BindingDialog dialog = new BindingDialog(tracks[index].ToBinding(), worker, port, true))
                if (dialog.ShowDialog(this) == DialogResult.OK) {
                    tracks[index] = GameEventTrack.FromBinding(dialog.Result);
                    RefreshTracks();
                    songsView.Items[index].Selected = true;
                }
        }
        void RemoveTrack()
        {
            int index = SelectedTrack(); if (index < 0) return;
            tracks.RemoveAt(index); RefreshTracks();
        }
        void TryTrack()
        {
            int index = SelectedTrack();
            if (index < 0) { MessageBox.Show(this, "先在列表里选中一首。", "还没选", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            string error = GameEventCatalog.ValidateTrack(tracks[index]);
            if (error != null) { MessageBox.Show(this, error, "还不能试听", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            if (preview == null) { MessageBox.Show(this, "现在不能试听。", "试一下", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            preview(tracks[index].ToBinding());
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
        readonly Action<HotkeyBinding> preview;
        readonly Random previewRandom = new Random();
        bool refreshing;
        public List<GameEventRule> Result { get; private set; }
        public bool MonitoringEnabled { get { return master.Checked; } }
        public GameEventsDialog(bool on, IEnumerable<GameEventRule> values, IList<HotkeyBinding> hotkeys, PlayWorker worker, int port)
            : this(on, values, hotkeys, worker, port, null) { }
        public GameEventsDialog(bool on, IEnumerable<GameEventRule> values, IList<HotkeyBinding> hotkeys, PlayWorker worker, int port, Action<HotkeyBinding> preview)
        {
            this.hotkeys = hotkeys; this.worker = worker; this.port = port; this.preview = preview;
            foreach (GameEventRule r in values) if (r != null) rules.Add(r.Clone());
            Text = "监听游戏事件（实验）"; Font = new Font("Microsoft YaHei UI", 9F);
            ClientSize = new Size(875, 505); MinimumSize = new Size(760, 470); StartPosition = FormStartPosition.CenterParent;
            master.Text = "启用游戏事件监听"; master.Checked = on; master.SetBounds(15, 15, 235, 26);
            Label hint = new Label { Text = "目前支持 GGST 凯发动龙装。训练场已验证；联网待验证，暂需手动勾选 1P / 2P。",
                Location = new Point(15, 48), Size = new Size(845, 28), Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right, ForeColor = Color.DarkGoldenrod };
            list.SetBounds(15, 83, 845, 245); list.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            list.View = View.Details; list.FullRowSelect = true; list.MultiSelect = false; list.CheckBoxes = true; list.HideSelection = false;
            list.Columns.Add("启用 / 游戏", 150); list.Columns.Add("事件", 130); list.Columns.Add("监听角色", 90);
            list.Columns.Add("播放曲目", 275); list.Columns.Add("起点", 75); list.Columns.Add("延迟", 75);
            list.ShowItemToolTips = true;
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
            Button tryRule = ButtonAt("试一下", 345, delegate { TrySelected(); });
            monitoringTip.SetToolTip(tryRule, "立刻随机播放选中规则中的一首，不等待触发延迟。");
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
            Controls.AddRange(new Control[] { master, hint, list, monitoring, add, edit, remove, tryRule, save, cancel, tip });
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
                item.SubItems.Add(GameEventCatalog.SongSummary(r)); item.SubItems.Add(GameEventCatalog.StartSummary(r));
                item.SubItems.Add(r.delaySeconds.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + " 秒");
                item.ToolTipText = GameEventCatalog.SongSummary(r); list.Items.Add(item);
            }
            list.EndUpdate(); refreshing = false;
        }
        void Add()
        {
            using (GameEventRuleDialog dialog = new GameEventRuleDialog(null, hotkeys, worker, port, preview))
                if (dialog.ShowDialog(this) == DialogResult.OK && Accept(dialog.Result)) { rules.Add(dialog.Result); RefreshRules(); }
        }
        void Edit()
        {
            int index = Selected(); if (index < 0) return;
            using (GameEventRuleDialog dialog = new GameEventRuleDialog(rules[index], hotkeys, worker, port, preview))
                if (dialog.ShowDialog(this) == DialogResult.OK && Accept(dialog.Result)) { rules[index] = dialog.Result; RefreshRules(); }
        }
        bool Accept(GameEventRule rule)
        {
            string error = GameEventCatalog.Conflict(rule, rules);
            if (error == null) return true;
            MessageBox.Show(this, error, "规则重叠", MessageBoxButtons.OK, MessageBoxIcon.Information); return false;
        }
        void TrySelected()
        {
            int index = Selected();
            if (index < 0) { MessageBox.Show(this, "先在列表里选中一条规则。", "还没选", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            string error = GameEventCatalog.Validate(rules[index]);
            if (error != null) { MessageBox.Show(this, error, "还不能试听", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            if (preview == null) { MessageBox.Show(this, "现在不能试听。", "试一下", MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            preview(rules[index].Pick(previewRandom));
        }
    }
}
