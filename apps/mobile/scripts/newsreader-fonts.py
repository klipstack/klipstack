"""
Cuts the app's Newsreader faces (assets/fonts, bundled by the expo-font plugin in app.json) from the
variable font the web loads (@fontsource-variable/newsreader, Latin): Regular and Italic at 400 for
text sizes (optical size 18), Medium at 500 for titles (optical size 36). Each face gets its own
PostScript name, which the app uses as its fontFamily (src/lib/theme.ts, `fonts`).

Run from the repository root, with fontTools (pip install fonttools brotli):
    python3 apps/mobile/scripts/newsreader-fonts.py \
        apps/web/node_modules/@fontsource-variable/newsreader apps/mobile/assets/fonts
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
src = sys.argv[1]
def make(file, wght, opsz, style, out):
    f = TTFont(f"{src}/files/{file}")
    inst = instantiateVariableFont(f, {"wght": wght, "opsz": opsz}, updateFontNames=False)
    n = inst["name"]
    for rec in list(n.names):
        if rec.nameID in (1,2,3,4,6,16,17,25): n.removeNames(nameID=rec.nameID)
    full = "Newsreader" if style == "Regular" else f"Newsreader {style}"
    ps = f"Newsreader-{style}"
    for nid, val in [(1,"Newsreader" if style in ("Regular","Italic") else f"Newsreader {style}"),(2,"Regular" if style not in ("Italic",) else "Italic"),(3,f"Klipstack;{ps}"),(4,full),(6,ps),(16,"Newsreader"),(17,style)]:
        n.setName(val, nid, 3, 1, 0x409); n.setName(val, nid, 1, 0, 0)
    os2 = inst["OS/2"]; os2.usWeightClass = wght
    if style == "Italic":
        os2.fsSelection = (os2.fsSelection | 1) & ~(1<<6); inst["head"].macStyle |= 2
    elif style == "Regular":
        os2.fsSelection = (os2.fsSelection | (1<<6)) & ~1
    else:
        os2.fsSelection = os2.fsSelection & ~1 & ~(1<<6)
    inst.flavor = None
    inst.save(out)
    print(out, ps)


make("newsreader-latin-standard-normal.woff2", 400, 18, "Regular", sys.argv[2]+"/Newsreader-Regular.ttf")
make("newsreader-latin-standard-italic.woff2", 400, 18, "Italic", sys.argv[2]+"/Newsreader-Italic.ttf")
make("newsreader-latin-standard-normal.woff2", 500, 36, "Medium", sys.argv[2]+"/Newsreader-Medium.ttf")
