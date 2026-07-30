import sys, fitz
src, out = sys.argv[1], sys.argv[2]
dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 200
# optional crop fraction: x0 y0 x1 y1 (0..1 of page)
doc = fitz.open(src)
page = doc[0]
r = page.rect
if len(sys.argv) >= 8:
    fx0, fy0, fx1, fy1 = [float(v) for v in sys.argv[4:8]]
    clip = fitz.Rect(r.x0+r.width*fx0, r.y0+r.height*fy0, r.x0+r.width*fx1, r.y0+r.height*fy1)
else:
    clip = None
pix = page.get_pixmap(dpi=dpi, clip=clip)
pix.save(out)
print("saved", out, pix.width, "x", pix.height)
