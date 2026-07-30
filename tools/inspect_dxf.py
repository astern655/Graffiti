import sys, io, collections
import ezdxf

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
path = sys.argv[1]
doc = ezdxf.readfile(path)
msp = doc.modelspace()

print("== FILE:", path)
try:
    ext = doc.header.get("$EXTMIN"), doc.header.get("$EXTMAX")
    print("EXTENTS:", ext)
except Exception as e:
    print("extents err", e)

# layers
print("\n-- LAYERS (name : #entities) --")
by_layer_type = collections.Counter()
layer_count = collections.Counter()
type_count = collections.Counter()
for e in msp:
    layer_count[e.dxf.layer] += 1
    type_count[e.dxftype()] += 1
    by_layer_type[(e.dxf.layer, e.dxftype())] += 1
for lyr, n in layer_count.most_common():
    print(f"  {lyr:35s} {n}")

print("\n-- ENTITY TYPES --")
for t, n in type_count.most_common():
    print(f"  {t:15s} {n}")

# text
print("\n-- TEXT / MTEXT (layer | text) --")
seen = 0
for e in msp:
    if e.dxftype() in ("TEXT", "MTEXT"):
        try:
            txt = e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.text
        except Exception:
            txt = getattr(e.dxf, "text", "")
        txt = (txt or "").strip().replace("\n", " ")
        if txt:
            print(f"  [{e.dxf.layer}] {txt[:80]}")
            seen += 1
    if seen > 200:
        print("  ... (truncated)")
        break
