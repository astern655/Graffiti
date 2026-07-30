import sys, io
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import ezdxf
from ezdxf.addons.drawing import RenderContext, Frontend
from ezdxf.addons.drawing.matplotlib import MatplotlibBackend

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
path, out = sys.argv[1], sys.argv[2]
# optional crop: xmin xmax ymin ymax
crop = [float(x) for x in sys.argv[3:7]] if len(sys.argv) >= 7 else None

import os
doc = ezdxf.readfile(path)
msp = doc.modelspace()
drop = set(x.strip() for x in os.environ.get("DROP_LAYERS", "").split(",") if x.strip())
if drop:
    for e in list(msp):
        if e.dxf.layer in drop:
            msp.delete_entity(e)

mono = os.environ.get("MONO") == "1"
fig = plt.figure(figsize=(24, 14))
ax = fig.add_axes([0, 0, 1, 1])
ax.set_facecolor("white")
ctx = RenderContext(doc)
if mono:
    # 흰 배경 + 검정 선 (배경 이미지용)
    from ezdxf.addons.drawing.config import Configuration, ColorPolicy, BackgroundPolicy
    cfg = Configuration(color_policy=ColorPolicy.BLACK, background_policy=BackgroundPolicy.WHITE)
    Frontend(ctx, MatplotlibBackend(ax), config=cfg).draw_layout(msp, finalize=True)
else:
    Frontend(ctx, MatplotlibBackend(ax)).draw_layout(msp, finalize=True)
if crop:
    ax.set_xlim(crop[0], crop[1]); ax.set_ylim(crop[2], crop[3])
ax.set_aspect("equal")
fig.savefig(out, dpi=110, facecolor="white")
print("saved", out)
