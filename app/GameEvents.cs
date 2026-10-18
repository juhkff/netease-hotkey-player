using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Threading;

namespace NcmHotkey
{
    public sealed class GameEventRule
    {
        public string id { get; set; }
        public bool enabled { get; set; }
        public string game { get; set; }
        public string eventId { get; set; }
        // Bit 0 = the initial 1P battle slot, bit 1 = 2P. These do not follow screen position.
        public int playerSlots { get; set; }
        public string songId { get; set; }
        public double seconds { get; set; }
        public double delaySeconds { get; set; }
        public string note { get; set; }
        public GameEventRule()
        {
            id = Guid.NewGuid().ToString("N"); enabled = true; game = "ggst";
            eventId = "ky.dragon-install"; playerSlots = 1; songId = ""; note = ""; delaySeconds = .4;
        }
        public GameEventRule Clone() { return (GameEventRule)MemberwiseClone(); }
        public HotkeyBinding Song() { return new HotkeyBinding { songId = songId, seconds = seconds, note = note ?? "" }; }
    }

    public static class GameEventCatalog
    {
        public static string GameName(string game) { return game == "ggst" ? "罪恶装备·奋战" : "未知游戏"; }
        public static string EventName(string id) { return id == "ky.dragon-install" ? "凯发动龙装" : "未知事件"; }
        public static string Slots(int mask) { return mask == 3 ? "1P + 2P" : mask == 2 ? "2P" : mask == 1 ? "1P" : "未选择"; }
        public static string Validate(GameEventRule rule)
        {
            if (rule == null || string.IsNullOrWhiteSpace(rule.id)) return "规则编号无效";
            if (rule.game != "ggst" || rule.eventId != "ky.dragon-install") return "此版本尚不支持该游戏事件";
            if (rule.playerSlots < 1 || rule.playerSlots > 3) return "请至少勾选 1P 或 2P";
            if (string.IsNullOrEmpty(rule.songId)) return "请选择歌曲";
            foreach (char c in rule.songId) if (c < '0' || c > '9') return "歌曲 ID 应为数字";
            if (double.IsNaN(rule.seconds) || double.IsInfinity(rule.seconds) || rule.seconds < 0 || rule.seconds > 86400) return "歌曲起点无效";
            if (double.IsNaN(rule.delaySeconds) || double.IsInfinity(rule.delaySeconds) || rule.delaySeconds < 0 || rule.delaySeconds > 30) return "延迟应在 0～30 秒之间";
            return null;
        }
        public static string Conflict(GameEventRule candidate, IEnumerable<GameEventRule> existing)
        {
            if (!candidate.enabled) return null;
            foreach (GameEventRule other in existing)
                if (other != null && other.enabled && other.id != candidate.id && other.game == candidate.game &&
                    other.eventId == candidate.eventId && (other.playerSlots & candidate.playerSlots) != 0)
                    return "同一游戏、事件和角色已有启用的规则。请先修改或停用那条规则，避免同时切换到不同歌曲。";
            return null;
        }
    }

    public sealed class DetectedGameEvent
    {
        public string Game, EventId;
        public int PlayerSlot;
    }
    public sealed class GameEventBatch
    {
        public string Game, Context, Status;
        public List<DetectedGameEvent> Events = new List<DetectedGameEvent>();
    }
    public interface IGameEventSource : IDisposable
    {
        GameEventBatch Poll(double now);
        void InvalidateBaseline();
        void Disconnect();
    }

    // Scheduling is game-independent: providers only report events, never play music.
    public sealed class GameEventRouter
    {
        sealed class Pending { public GameEventRule Rule; public string Context; public double Due; }
        readonly List<GameEventRule> rules = new List<GameEventRule>();
        readonly Dictionary<string, Pending> pending = new Dictionary<string, Pending>();
        readonly Dictionary<string, string> contexts = new Dictionary<string, string>();
        public void SetRules(IEnumerable<GameEventRule> values)
        {
            rules.Clear(); pending.Clear(); contexts.Clear();
            HashSet<string> ids = new HashSet<string>();
            foreach (GameEventRule value in values)
                if (GameEventCatalog.Validate(value) == null && value.enabled && ids.Add(value.id) && GameEventCatalog.Conflict(value, rules) == null)
                    rules.Add(value.Clone());
        }
        public void Invalidate(string game)
        {
            List<string> remove = new List<string>();
            foreach (KeyValuePair<string, Pending> p in pending) if (p.Value.Rule.game == game) remove.Add(p.Key);
            foreach (string id in remove) pending.Remove(id);
            contexts.Remove(game);
        }
        public List<GameEventRule> Process(GameEventBatch batch, double now)
        {
            string old;
            if (!contexts.TryGetValue(batch.Game, out old) || old != batch.Context) Invalidate(batch.Game);
            contexts[batch.Game] = batch.Context;
            foreach (DetectedGameEvent e in batch.Events) {
                if (e.Game != batch.Game || e.PlayerSlot < 0 || e.PlayerSlot > 1) continue;
                foreach (GameEventRule r in rules)
                    if (r.game == e.Game && r.eventId == e.EventId && (r.playerSlots & (1 << e.PlayerSlot)) != 0 && !pending.ContainsKey(r.id))
                        pending.Add(r.id, new Pending { Rule = r.Clone(), Context = batch.Context, Due = now + r.delaySeconds });
            }
            List<GameEventRule> fire = new List<GameEventRule>();
            List<string> done = new List<string>();
            foreach (KeyValuePair<string, Pending> pair in pending) {
                Pending p = pair.Value;
                if (p.Rule.game == batch.Game && p.Context == batch.Context && now >= p.Due) { fire.Add(p.Rule.Clone()); done.Add(pair.Key); }
            }
            foreach (string id in done) pending.Remove(id);
            return fire;
        }
    }

    // No UI or playback worker belongs to this service. MainForm supplies the shared playback action.
    public sealed class GameEventService : IDisposable
    {
        readonly object sync = new object();
        readonly AutoResetEvent wake = new AutoResetEvent(false);
        readonly Thread thread;
        readonly Func<string, IGameEventSource> factory;
        readonly GameEventRouter router = new GameEventRouter();
        List<GameEventRule> rules = new List<GameEventRule>();
        bool enabled;
        volatile bool stopped;
        long revision;
        public event Action<GameEventRule, long> PlayRequested;
        public event Action<string, long> StatusChanged;
        public GameEventService() : this(delegate(string game) { return new GgstEventSource(); }) { }
        public GameEventService(Func<string, IGameEventSource> factory)
        {
            this.factory = factory;
            thread = new Thread(Run); thread.IsBackground = true; thread.Name = "Game events"; thread.Start();
        }
        public void Configure(bool on, IEnumerable<GameEventRule> values)
        {
            List<GameEventRule> copy = new List<GameEventRule>();
            foreach (GameEventRule r in values) if (r != null) copy.Add(r.Clone());
            lock (sync) { enabled = on; rules = copy; revision++; }
            wake.Set();
        }
        public bool IsCurrent(long version) { lock (sync) return !stopped && enabled && revision == version; }
        public void CancelPending() { lock (sync) revision++; wake.Set(); }
        void Run()
        {
            Dictionary<string, IGameEventSource> sources = new Dictionary<string, IGameEventSource>();
            Dictionary<string, double> retryAt = new Dictionary<string, double>();
            Dictionary<string, string> statuses = new Dictionary<string, string>();
            Stopwatch clock = Stopwatch.StartNew(); long applied = -1;
            List<GameEventRule> active = new List<GameEventRule>();
            try {
                while (!stopped) {
                    long version; bool on; List<GameEventRule> latest;
                    lock (sync) { version = revision; on = enabled; latest = rules; }
                    if (version != applied) {
                        active = new List<GameEventRule>();
                        if (on) foreach (GameEventRule r in latest)
                            if (r.enabled && GameEventCatalog.Validate(r) == null && GameEventCatalog.Conflict(r, active) == null) active.Add(r);
                        router.SetRules(active); foreach (IGameEventSource s in sources.Values) s.InvalidateBaseline();
                        retryAt.Clear(); statuses.Clear(); applied = version;
                    }
                    HashSet<string> games = new HashSet<string>(); foreach (GameEventRule r in active) games.Add(r.game);
                    List<string> removed = new List<string>(); foreach (string game in sources.Keys) if (!games.Contains(game)) removed.Add(game);
                    foreach (string game in removed) { sources[game].Dispose(); sources.Remove(game); }
                    if (games.Count == 0) {
                        string message = on ? "游戏事件：没有可用的启用规则" : "游戏事件：未启用";
                        PublishStatus("", message, applied, statuses); wake.WaitOne(500); continue;
                    }
                    foreach (string game in games) {
                        if (stopped) break;
                        double next; if (retryAt.TryGetValue(game, out next) && clock.Elapsed.TotalSeconds < next) continue;
                        try {
                            IGameEventSource source;
                            if (!sources.TryGetValue(game, out source)) { source = factory(game); sources.Add(game, source); }
                            GameEventBatch batch = source.Poll(clock.Elapsed.TotalSeconds);
                            PublishStatus(game, batch.Status, applied, statuses);
                            foreach (GameEventRule r in router.Process(batch, clock.Elapsed.TotalSeconds))
                                if (IsCurrent(applied) && PlayRequested != null) PlayRequested(r, applied);
                        } catch (Exception e) {
                            IGameEventSource source; if (sources.TryGetValue(game, out source)) source.Disconnect();
                            router.Invalidate(game); retryAt[game] = clock.Elapsed.TotalSeconds + 2;
                            PublishStatus(game, GameEventCatalog.GameName(game) + "：" + e.Message, applied, statuses);
                        }
                    }
                    wake.WaitOne(20);
                }
            } finally { foreach (IGameEventSource source in sources.Values) source.Dispose(); wake.Dispose(); }
        }
        void PublishStatus(string game, string message, long version, Dictionary<string, string> statuses)
        {
            string old; if (statuses.TryGetValue(game, out old) && old == message) return;
            statuses[game] = message;
            if (StatusChanged != null) StatusChanged(message, version);
        }
        public void Dispose()
        {
            lock (sync) { if (stopped) return; stopped = true; revision++; }
            wake.Set(); if (Thread.CurrentThread != thread) thread.Join(300);
        }
    }
}
