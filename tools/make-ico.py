#!/usr/bin/env python3
"""生成 app/app.ico —— 和程序里 RuntimeIcon 画的是同一个图案：
蓝色圆角方块 + 白色播放三角。纯 Python 手写 ICO（BMP 格式，32bpp），不依赖 PIL。"""
import math
import os
import struct

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'app.ico')

# 蓝色渐变的两端（和 C# 里一致）
TOP = (58, 138, 255)
BOT = (20, 74, 186)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def in_tri(px, py, ax, ay, bx, by, cx, cy):
    """标准重心/边侧判定：三个边侧同号即在三角形内。"""
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def render(size, ss=4):
    """返回 size*size 的 (r,g,b,a)，4x 超采样抗锯齿。"""
    n = size * ss
    acc = [[[0, 0, 0, 0] for _ in range(size)] for _ in range(size)]
    pad = max(1, size // 16) * ss
    rad = max(2, size // 4) * ss
    lo, hi = pad, n - pad - 1

    def inside_round(x, y):
        if x < lo or x > hi or y < lo or y > hi:
            return False
        cx = min(max(x, lo + rad), hi - rad)
        cy = min(max(y, lo + rad), hi - rad)
        return (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad

    # 白色三角（重心判定），稍微内缩一点
    ax, ay = n * 0.34, n * 0.26
    bx, by = n * 0.34, n * 0.74
    cx_, cy_ = n * 0.76, n * 0.50

    for y in range(n):
        for x in range(n):
            if not inside_round(x, y):
                continue
            # 渐变
            t = (y - lo) / max(1.0, hi - lo)
            r, g, b = lerp(TOP, BOT, t)
            # 三角判定
            if in_tri(x, y, ax, ay, bx, by, cx_, cy_):
                r = g = b = 255
            oy, ox = y // ss, x // ss
            a = acc[oy][ox]
            a[0] += r
            a[1] += g
            a[2] += b
            a[3] += 255

    px = []
    k = ss * ss
    for y in range(size):
        row = []
        for x in range(size):
            r, g, b, a = acc[y][x]
            cnt = a // 255
            if cnt == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append((r // cnt, g // cnt, b // cnt, min(255, a // k)))
        px.append(row)
    return px


def ico_image(size, px):
    """BITMAPINFOHEADER + BGRA（自下而上）+ AND 掩码。"""
    hdr = struct.pack('<IiiHHIIiiII', 40, size, size * 2, 1, 32, 0,
                      size * size * 4, 0, 0, 0, 0)
    xor = bytearray()
    for y in range(size - 1, -1, -1):
        for x in range(size):
            r, g, b, a = px[y][x]
            xor += bytes((b, g, r, a))
    stride = ((size + 31) // 32) * 4
    and_mask = bytes(stride * size)
    return bytes(hdr) + bytes(xor) + and_mask


def main():
    sizes = [16, 32, 48]
    images = [ico_image(s, render(s)) for s in sizes]
    out = bytearray(struct.pack('<HHH', 0, 1, len(sizes)))
    offset = 6 + 16 * len(sizes)
    for s, img in zip(sizes, images):
        out += struct.pack('<BBBBHHII', s % 256, s % 256, 0, 0, 1, 32, len(img), offset)
        offset += len(img)
    for img in images:
        out += img
    path = os.path.normpath(OUT)
    with open(path, 'wb') as f:
        f.write(bytes(out))
    print('wrote', path, len(out), 'bytes')


if __name__ == '__main__':
    main()
