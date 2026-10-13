#!/usr/bin/env python3
"""从压缩 JS 里取关键字的上下文。
用法: ctx.py <file> <needle> [before] [after] [max] [--fmt]
"""
import sys

args = [a for a in sys.argv[1:] if a != '--fmt']
FMT = '--fmt' in sys.argv
f, needle = args[0], args[1]
before = int(args[2]) if len(args) > 2 else 250
after = int(args[3]) if len(args) > 3 else 400
maxn = int(args[4]) if len(args) > 4 else 6

s = open(f, encoding='utf-8', errors='replace').read()


def fmt(t):
    if not FMT:
        return t
    out = []
    for ch in t:
        if ch in ';{}':
            out.append(ch)
            out.append('\n')
        else:
            out.append(ch)
    return ''.join(out)


idx = 0
cnt = 0
while cnt < maxn:
    i = s.find(needle, idx)
    if i < 0:
        break
    print('--- match %d @ %d ---' % (cnt + 1, i))
    print(fmt(s[max(0, i - before):i + after]))
    print()
    idx = i + 1
    cnt += 1
print('total occurrences: %d' % s.count(needle))
