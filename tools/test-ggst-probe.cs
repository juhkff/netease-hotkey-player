using System;
using NcmHotkey;
public static class GgstGateTests
{
    static int checks;
    static void Check(bool condition, string name) { checks++; if (!condition) throw new Exception(name); }
    public static void Main()
    {
        DragonEntryGate g = new DragonEntryGate();
        Check(!g.Observe(1, "CmnActStand", "kyk000_01", 0, true), "baseline");
        Check(!g.Observe(1, "DragonInstall", "kyk600_00", 1, true), "delay entry");
        Check(!g.Observe(1, "DragonInstall", "kyk600_00", 1.39, true), "delay not elapsed");
        Check(g.Observe(1, "DragonInstall", "kyk600_00", 1.41, true), "fire once");
        Check(!g.Observe(1, "DragonInstall", "kyk600_00", 2, true), "continuous state");
        Check(!g.Observe(1, "CmnActStand", "kyk000_01", 4.8, true), "cinematic end no new command");
        Check(!g.Observe(1, "DragonInstall", "kyk600_00", 4.9, true), "rollback cooldown");
        Check(!g.Observe(1, "CmnActStand", "kyk000_01", 12, true), "rearm");
        Check(!g.Observe(1, "DragonInstall", "kyk600_00", 13, true), "new activation delay");
        Check(g.Observe(1, "DragonInstall", "kyk600_00", 13.5, true), "new activation");
        g.Reset();
        Check(!g.Observe(2, "DragonInstall", "kyk600_00", 30, true), "attach mid animation");
        Check(!g.Observe(2, "DragonInstall", "kyk600_00", 31, true), "no false initial trigger");
        g.Reset();g.Observe(1,"CmnActStand","sol000_01",0,true);
        Check(!g.Observe(1,"DragonInstall","sol600_00",1,true),"non Ky");
        Check(!g.Observe(1,"DragonInstall","sol600_00",2,true),"non Ky delayed");
        g.Reset();g.Observe(1,"CmnActStand","kyk000_01",0,true);g.Observe(1,"DragonInstall","kyk600_00",1,true);
        Check(!g.Observe(1,"DragonInstall","kyk600_00",2,false),"disable cancels pending");
        Check(!g.Observe(1,"DragonInstall","kyk600_00",3,true),"enable mid animation");
        g.Reset();g.Observe(1,"CmnActStand","kyk000_01",0,true);g.Observe(1,"DragonInstall","kyk600_00",1,true);
        Check(!g.Observe(2,"CmnActStand","kyk000_01",2,true),"new entity cancels pending");
        Console.WriteLine("Passed " + checks + " event-gate checks.");
    }
}
