import sys, io
import ezdxf
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

doc = ezdxf.readfile(sys.argv[1])
msp = doc.modelspace()

# collect x-midpoints of wall-ish geometry to cluster into 7 floor plots
xs = []
pts = []  # (x,y)
for e in msp:
    t = e.dxftype()
    if t == "LINE":
        pts.append((e.dxf.start.x, e.dxf.start.y)); pts.append((e.dxf.end.x, e.dxf.end.y))
    elif t == "LWPOLYLINE":
        for p in e.get_points("xy"):
            pts.append((p[0], p[1]))

xs = sorted(p[0] for p in pts)
# find big gaps to split clusters
gaps = []
for i in range(1, len(xs)):
    d = xs[i] - xs[i-1]
    if d > 15000:  # 15m gap = between floor plots
        gaps.append((xs[i-1], xs[i], d))
# derive cluster boundaries
bounds = [xs[0]]
for a, b, d in gaps:
    bounds.append((a + b) / 2)
bounds.append(xs[-1])
print("num split points:", len(bounds)-1)
clusters = []
for i in range(len(bounds)-1):
    lo, hi = bounds[i], bounds[i+1]
    cp = [p for p in pts if lo <= p[0] <= hi]
    if not cp: continue
    x0 = min(p[0] for p in cp); x1 = max(p[0] for p in cp)
    y0 = min(p[1] for p in cp); y1 = max(p[1] for p in cp)
    clusters.append((x0, x1, y0, y1, len(cp)))
for i, c in enumerate(clusters):
    print(f"floor[{i}] x[{c[0]:.0f}..{c[1]:.0f}] y[{c[2]:.0f}..{c[3]:.0f}] w={c[1]-c[0]:.0f} h={c[3]-c[2]:.0f} pts={c[4]}")
