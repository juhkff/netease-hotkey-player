// Read-only GGST provider. Current game layout is training-verified only.
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
    // Supported layout was checked against this local executable in training mode.
    // Fail closed for other versions, invalid pointers, menus and incomplete reads.
    public sealed class GgstReadOnly : IDisposable
    {
        const string SupportedHash = "5B5AB0178660BDFD5E8B846DFB40EC976F946B75E24D624125D66951D16F53ED";
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] buffer, UIntPtr size, out UIntPtr read);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        IntPtr handle;
        Process process;
        long worldAddress;
        public int ProcessId { get { return process.Id; } }
        public bool Alive { get { try { return process != null && !process.HasExited; } catch (InvalidOperationException) { return false; } } }
        static bool Pointer(long p) { return p >= 0x10000 && p < 0x7fffffffffff; }
        public byte[] Read(long p, int count)
        {
            if (!Pointer(p)) throw new IOException("无效指针");
            byte[] data = new byte[count]; UIntPtr got;
            if (!ReadProcessMemory(handle, new IntPtr(p), data, new UIntPtr((uint)count), out got) || got.ToUInt64() != (ulong)count)
                throw new IOException("游戏数据暂不可读");
            return data;
        }
        public long Ptr(long p) { return BitConverter.ToInt64(Read(p, 8), 0); }
        public int Int(long p) { return BitConverter.ToInt32(Read(p, 4), 0); }
        static string Text(byte[] data, int start)
        {
            int end = start;
            while (end < data.Length && data[end] != 0) {
                if (data[end] < 32 || data[end] > 126) throw new IOException("动作名称无效");
                end++;
            }
            if (end == data.Length || end == start) throw new IOException("动作名称不完整");
            return Encoding.ASCII.GetString(data, start, end - start);
        }
        public static GgstReadOnly Attach()
        {
            Process[] all = Process.GetProcessesByName("GGST-Win64-Shipping");
            if (all.Length == 0) throw new IOException("等待游戏启动");
            if (all.Length != 1) { foreach (Process p in all) p.Dispose(); throw new IOException("发现多个游戏进程，暂停识别"); }
            GgstReadOnly reader = new GgstReadOnly(); reader.process = all[0];
            try {
                ProcessModule module = reader.process.MainModule;
                using (FileStream file = File.OpenRead(module.FileName))
                using (SHA256 hash = SHA256.Create())
                    if (BitConverter.ToString(hash.ComputeHash(file)).Replace("-", "") != SupportedHash)
                        throw new IOException("游戏版本未验证，停止读取");
                reader.handle = OpenProcess(0x410, false, reader.process.Id); // QUERY_INFORMATION | VM_READ only
                if (reader.handle == IntPtr.Zero) throw new IOException("无法只读打开游戏：" + Marshal.GetLastWin32Error());
                long image = module.BaseAddress.ToInt64();
                byte[] headers = reader.Read(image, 4096);
                int pe = BitConverter.ToInt32(headers, 0x3c), count = BitConverter.ToUInt16(headers, pe + 6);
                int table = pe + 24 + BitConverter.ToUInt16(headers, pe + 20), textSize = 0, textRva = 0;
                for (int i = 0; i < count; i++) {
                    int s = table + i * 40;
                    if (Encoding.ASCII.GetString(headers, s, 8).TrimEnd('\0') == ".text") {
                        textSize = BitConverter.ToInt32(headers, s + 8); textRva = BitConverter.ToInt32(headers, s + 12);
                    }
                }
                if (textSize <= 0 || textSize > 128 * 1024 * 1024) throw new IOException("代码节无效");
                // Scan the running image; the on-disk Steam image does not contain this signature.
                byte[] code = reader.Read(image + textRva, textSize);
                int matches = 0;
                for (int p = 0; p + 16 <= code.Length; p++) {
                    if (code[p] == 0x0f && code[p+1] == 0x2e && code[p+3] == 0x74 &&
                        code[p+5] == 0x48 && code[p+6] == 0x8b && code[p+7] == 0x1d &&
                        code[p+12] == 0x48 && code[p+13] == 0x85 && code[p+14] == 0xdb && code[p+15] == 0x74) {
                        reader.worldAddress = image + textRva + p + 12 + BitConverter.ToInt32(code, p + 8); matches++;
                    }
                }
                if (matches != 1) throw new IOException("状态定位不是唯一匹配，停止识别");
                return reader;
            } catch { reader.Dispose(); throw; }
        }
        public sealed class Snapshot
        {
            public long World, Engine;
            public long[] Entity = new long[2];
            public string[] State = new string[2], Sprite = new string[2];
        }
        public Snapshot Sample()
        {
            if (process.HasExited) throw new IOException("游戏已退出");
            Snapshot s = new Snapshot();
            s.World = Ptr(worldAddress);
            long gs = Ptr(s.World + 0x130); s.Engine = Ptr(gs + 0xc38);
            for (int slot = 0; slot < 2; slot++) {
                long ent = Ptr(s.Engine + 8 + 0x198 * slot); s.Entity[slot] = ent;
                long begin = Ptr(ent + 0x12f0); byte[] state = Read(begin, 36);
                if (BitConverter.ToInt32(state, 0) != 0) throw new IOException("尚未进入可识别对战场景");
                s.State[slot] = Text(state, 4); s.Sprite[slot] = Text(Read(ent + 0x12f8, 32), 0);
                if (s.State[slot].Length > 31) throw new IOException("状态名超出验证范围");
            }
            // A transition while reading can mix old and new scenes. Never emit it.
            if (Ptr(worldAddress) != s.World || Ptr(gs + 0xc38) != s.Engine ||
                Ptr(s.Engine + 8) != s.Entity[0] || Ptr(s.Engine + 0x1a0) != s.Entity[1])
                throw new IOException("场景切换中");
            return s;
        }
        public void Dispose()
        {
            if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; }
            if (process != null) { process.Dispose(); process = null; }
        }
    }

    // Event logic is independent of the client and can be tested from real recordings.
    public sealed class DragonEntryGate
    {
        string previous;
        long entity;
        double lastFire = double.NegativeInfinity, pending = -1;
        public bool Observe(long owner, string state, string sprite, double now, bool armed)
        { return Observe(owner, state, sprite, now, armed, .4); }
        public bool Observe(long owner, string state, string sprite, double now, bool armed, double delay)
        {
            if (owner != entity) { Reset(); entity = owner; }
            if (previous == null) { previous = state; return false; } // attaching mid-cinematic must not fire
            bool entry = state == "DragonInstall" && previous != "DragonInstall" && sprite.StartsWith("kyk", StringComparison.Ordinal);
            previous = state;
            if (!armed) { pending = -1; return false; }
            if (entry && now - lastFire >= 8 && pending < 0) pending = now;
            if (pending >= 0 && now - pending >= delay) { pending = -1; lastFire = now; return true; }
            return false;
        }
        public void InvalidateBaseline() { previous = null; pending = -1; }
        public void Reset() { previous = null; entity = 0; pending = -1; lastFire = double.NegativeInfinity; }
    }

    public sealed class GgstEventSource : IGameEventSource
    {
        GgstReadOnly reader;
        string context;
        readonly DragonEntryGate[] gates = new DragonEntryGate[] { new DragonEntryGate(), new DragonEntryGate() };
        public GameEventBatch Poll(double now)
        {
            if (reader == null) reader = GgstReadOnly.Attach();
            GgstReadOnly.Snapshot s = reader.Sample();
            string current = reader.ProcessId + ":" + s.World + ":" + s.Engine + ":" + s.Entity[0] + ":" + s.Entity[1];
            if (current != context) { foreach (DragonEntryGate g in gates) g.Reset(); context = current; }
            GameEventBatch batch = new GameEventBatch { Game = "ggst", Context = current,
                Status = "GGST · 1P：" + s.State[0] + " · 2P：" + s.State[1] };
            for (int slot = 0; slot < 2; slot++)
                if (gates[slot].Observe(s.Entity[slot], s.State[slot], s.Sprite[slot], now, true, 0))
                    batch.Events.Add(new DetectedGameEvent { Game = "ggst", EventId = "ky.dragon-install", PlayerSlot = slot });
            return batch;
        }
        public void InvalidateBaseline() { foreach (DragonEntryGate g in gates) g.InvalidateBaseline(); }
        public void Disconnect()
        {
            // Menus temporarily lack battle data. Keep a live read handle rather than
            // hashing and scanning the same executable again every two seconds.
            if (reader != null && !reader.Alive) { reader.Dispose(); reader = null; }
            InvalidateBaseline();
        }
        public void Dispose() { if (reader != null) reader.Dispose(); reader = null; InvalidateBaseline(); }
    }
}
