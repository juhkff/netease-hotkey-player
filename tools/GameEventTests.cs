using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using NcmHotkey;

public static class GameEventTests
{
    static int checks;
    static void Check(bool condition, string message) { checks++; if (!condition) throw new Exception(message); }
    static GameEventRule Rule(int mask, double delay)
    {
        return new GameEventRule { playerSlots = mask, delaySeconds = delay, songId = "3362244118", note = "雨爱 (DJ版) / DYYL." };
    }
    static GameEventBatch Batch(string context, params int[] slots)
    {
        GameEventBatch b = new GameEventBatch { Game = "ggst", Context = context, Status = "test" };
        foreach (int slot in slots) b.Events.Add(new DetectedGameEvent { Game = "ggst", EventId = "ky.dragon-install", PlayerSlot = slot });
        return b;
    }
    sealed class FakeSource : IGameEventSource
    {
        public readonly ManualResetEvent Polled = new ManualResetEvent(false);
        public int Polls, Disposals;
        public bool Fail;
        public GameEventBatch Poll(double now)
        {
            int n = Interlocked.Increment(ref Polls); Polled.Set();
            if (Fail && n > 1) throw new IOException("fake disconnected");
            return n == 1 ? Batch("match", 0, 1) : Batch("match");
        }
        public void Disconnect() { }
        public void InvalidateBaseline() { }
        public void Dispose() { Interlocked.Increment(ref Disposals); }
    }
    static T Field<T>(object value, string name) { return (T)value.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance).GetValue(value); }
    static void Click(IButtonControl button) { typeof(Button).GetMethod("OnClick", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(button, new object[] { EventArgs.Empty }); }
    [STAThread] public static int Main(string[] args)
    {
        try {
            Application.EnableVisualStyles();
            JavaScriptSerializer json = new JavaScriptSerializer();
            AppConfig old = json.Deserialize<AppConfig>("{\"port\":9229,\"hotkeys\":[{\"hotkey\":\"Oemplus\",\"songId\":\"3362244118\",\"seconds\":0,\"note\":\"雨爱\"}],\"restoreHotkey\":\"OemMinus\",\"clipMode\":true}");
            Check(!old.gameEventsEnabled && old.gameEvents.Count == 0, "old config must default to no game reads");
            Check(old.hotkeys[0].hotkey == "Oemplus" && old.restoreHotkey == "OemMinus", "existing hotkeys preserved");
            old.gameEvents.Add(Rule(3, .4)); old.gameEventsEnabled = true;
            AppConfig roundtrip = json.Deserialize<AppConfig>(json.Serialize(old));
            Check(roundtrip.gameEventsEnabled && roundtrip.gameEvents[0].playerSlots == 3 && roundtrip.gameEvents[0].note.Contains("雨爱"), "rules roundtrip");
            GameEventRule p1 = Rule(1, .4), p2 = Rule(2, .4), both = Rule(3, .4);
            Check(GameEventCatalog.Validate(both) == null, "both slots valid");
            Check(GameEventCatalog.Conflict(p2, new GameEventRule[] { p1 }) == null, "distinct slots can use distinct songs");
            Check(GameEventCatalog.Conflict(both, new GameEventRule[] { p1 }) != null, "overlap cannot race songs");
            GameEventRule invalid = Rule(0, 0);
            Check(GameEventCatalog.Validate(invalid) != null, "no slots invalid");
            invalid.playerSlots = 4; Check(GameEventCatalog.Validate(invalid) != null, "unsupported slot invalid");
            invalid = Rule(1, double.NaN); Check(GameEventCatalog.Validate(invalid) != null, "NaN delay invalid");
            invalid = Rule(1, .4); invalid.seconds = double.PositiveInfinity; Check(GameEventCatalog.Validate(invalid) != null, "infinite song position invalid");
            invalid = Rule(1, .4); invalid.eventId = "future"; Check(GameEventCatalog.Validate(invalid) != null, "unsupported event invalid");
            GameEventRouter router = new GameEventRouter(); router.SetRules(new GameEventRule[] { p1 });
            Check(router.Process(Batch("a", 1), 0).Count == 0 && router.Process(Batch("a"), 1).Count == 0, "P1 ignores P2");
            Check(router.Process(Batch("a", 0), 2).Count == 0, "delay scheduled");
            Check(router.Process(Batch("a"), 2.39).Count == 0, "delay before due");
            Check(router.Process(Batch("a"), 2.41).Count == 1, "due request once");
            Check(router.Process(Batch("a"), 3).Count == 0, "pending removed");
            router.SetRules(new GameEventRule[] { both });
            Check(router.Process(Batch("a", 0, 1), 0).Count == 0, "both schedule");
            Check(router.Process(Batch("a"), .41).Count == 1, "simultaneous sides merge");
            router.SetRules(new GameEventRule[] { both });router.Process(Batch("a", 0), 0);router.Process(Batch("a", 1), .2);
            Check(router.Process(Batch("a"), .41).Count == 1, "second side within delay does not extend it");
            router.SetRules(new GameEventRule[] { both });router.Process(Batch("a", 0), 0);
            Check(router.Process(Batch("b"), 1).Count == 0, "new match cancels pending");
            router.Process(Batch("b", 1), 2); router.Invalidate("ggst");
            Check(router.Process(Batch("b"), 3).Count == 0, "read failure cancels pending");
            router.SetRules(new GameEventRule[] { both });router.Process(Batch("a", 0), 0);both.enabled = false;router.SetRules(new GameEventRule[] { both });
            Check(router.Process(Batch("a"), 1).Count == 0, "disabled rule cancels pending");
            both.enabled = true;router.SetRules(new GameEventRule[] { both });router.Process(Batch("a", 0), 0);both.songId = "316100";
            Check(router.Process(Batch("a"), 1)[0].songId == "3362244118", "pending has immutable snapshot");
            both.songId = "3362244118";
            router.SetRules(new GameEventRule[] { p1, p2 });router.Process(Batch("a", 0, 1), 0);
            Check(router.Process(Batch("a"), 1).Count == 2, "distinct rules for both sides route independently");
            DragonEntryGate gate = new DragonEntryGate();gate.Observe(1, "CmnActStand", "kyk000", 0, true, 0);
            Check(gate.Observe(1, "DragonInstall", "kyk600", 1, true, 0), "provider emits entry");
            gate.InvalidateBaseline();gate.Observe(1, "CmnActStand", "kyk000", 2, true, 0);
            Check(!gate.Observe(1, "DragonInstall", "kyk600", 3, true, 0), "read interruption preserves cooldown");

            int factories = 0, requested = 0; FakeSource fake = new FakeSource();
            using (ManualResetEvent played = new ManualResetEvent(false))
            using (GameEventService service = new GameEventService(delegate(string game) { Interlocked.Increment(ref factories); return fake; })) {
                service.PlayRequested += delegate(GameEventRule r, long v) { Interlocked.Increment(ref requested); played.Set(); };
                service.Configure(false, new GameEventRule[] { Rule(3, 0) });
                Check(!fake.Polled.WaitOne(100) && factories == 0, "disabled service never opens a game");
                service.Configure(true, new GameEventRule[] { Rule(3, 0) });
                Check(played.WaitOne(2000) && requested == 1, "service delivers merged real pipeline request");
                service.Configure(false, new GameEventRule[0]);
            }
            Check(fake.Disposals == 1, "provider disposed on service stop");
            fake = new FakeSource();requested = 0;
            using (ManualResetEvent played = new ManualResetEvent(false))
            using (GameEventService service = new GameEventService(delegate(string game) { return fake; })) {
                service.PlayRequested += delegate { Interlocked.Increment(ref requested); played.Set(); };
                service.Configure(true, new GameEventRule[] { Rule(3, .3) });
                Check(fake.Polled.WaitOne(2000), "pending source polled");service.CancelPending();
                Check(!played.WaitOne(450), "restore cancels pending callback");
            }
            fake = new FakeSource { Fail = true };
            using (ManualResetEvent played = new ManualResetEvent(false))
            using (GameEventService service = new GameEventService(delegate(string game) { return fake; })) {
                service.PlayRequested += delegate { played.Set(); };
                service.Configure(true, new GameEventRule[] { Rule(3, .15) });
                Check(fake.Polled.WaitOne(2000) && !played.WaitOne(350), "source error cannot release pending playback");
            }
            using (GameEventRuleDialog dialog = new GameEventRuleDialog(both, old.hotkeys, null, 9229)) {
                Check(Field<CheckBox>(dialog, "p1").Checked && Field<CheckBox>(dialog, "p2").Checked, "both UI boxes loaded");
                Click(dialog.AcceptButton);Check(dialog.Result.playerSlots == 3, "both UI boxes saved");
            }
            using (BindingDialog dialog = new BindingDialog(both.Song(), null, 9229, true)) {
                Check(!dialog.Controls.Contains(Field<TextBox>(dialog, "hotkeyBox")), "song picker does not ask for a key");
                Click(dialog.AcceptButton);Check(dialog.Result.songId == both.songId, "song picker saves without a key");
            }
            if (args.Length > 0) {
                using (GameEventsDialog dialog = new GameEventsDialog(true, new GameEventRule[] { both }, old.hotkeys, null, 9229)) {
                    dialog.UpdateMonitoringStatus("GGST · 1P：DragonInstall · 2P：CmnActStand2Crouch");
                    Render(dialog, Path.Combine(args[0], "game-events.png"));
                    dialog.ClientSize = new Size(744, 431);
                    Render(dialog, Path.Combine(args[0], "game-events-small.png"));
                }
                using (GameEventRuleDialog dialog = new GameEventRuleDialog(both, old.hotkeys, null, 9229)) Render(dialog, Path.Combine(args[0], "game-event-rule.png"));
            }
            Console.WriteLine("Passed " + checks + " game-event checks (routing, both sides, config, lifecycle and forms)."); return 0;
        } catch (Exception e) { Console.Error.WriteLine(e); return 1; }
    }
    static void Render(Form form, string path)
    {
        form.ShowInTaskbar = false; form.StartPosition = FormStartPosition.Manual; form.Location = new Point(-30000, -30000);
        form.Show(); Application.DoEvents();
        using (Bitmap bitmap = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(bitmap, new Rectangle(0, 0, form.Width, form.Height)); bitmap.Save(path); }
        form.Hide();
    }
}
