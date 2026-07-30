import sys, io
import ezdxf
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
doc = ezdxf.readfile(sys.argv[1])
msp = doc.modelspace()
needle = sys.argv[2] if len(sys.argv) > 2 else None
for e in msp:
    if e.dxftype() == "TEXT":
        t = (e.dxf.text or "").strip()
        if needle is None or needle in t:
            p = e.dxf.insert
            print(f"({p.x:.0f},{p.y:.0f})  {t}")
