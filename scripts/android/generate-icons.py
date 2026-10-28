#!/usr/bin/env python3
"""Install the KumbhConnect launcher icon + splash into the generated android/ project.

`npx cap add android` creates the project with Capacitor's DEFAULT icon and splash.
Nothing in the build replaced them, so the APK shipped with the wrong (or no) icon.
This script runs after `cap sync` and overwrites:
  - mipmap-*/ic_launcher.png, ic_launcher_round.png      (legacy / pre-Android 8)
  - mipmap-*/ic_launcher_foreground.png                  (adaptive icon foreground)
  - values/ic_launcher_background.xml                    (adaptive icon background colour)
  - mipmap-anydpi-v26/ic_launcher(.round).xml            (adaptive icon definition)
  - drawable*/splash.png                                 (splash screen)
Sources: icon-512.png (legacy) and icon-maskable-512.png (adaptive foreground).
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "android" / "app" / "src" / "main" / "res"
ICON = ROOT / "icon-512.png"
MASKABLE = ROOT / "icon-maskable-512.png"
BG_HEX = "#FFFFFF"           # both source icons are drawn on white
BG = (255, 255, 255, 255)

LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def fail(msg):
    print("::error::" + msg)
    sys.exit(1)


def square(path):
    im = Image.open(path).convert("RGBA")
    if im.width != im.height:
        side = max(im.size)
        c = Image.new("RGBA", (side, side), BG)
        c.paste(im, ((side - im.width) // 2, (side - im.height) // 2), im)
        im = c
    return im


def flatten(im):
    base = Image.new("RGBA", im.size, BG)
    base.alpha_composite(im)
    return base


def legacy_square(src, size):
    return flatten(src).resize((size, size), Image.LANCZOS)


def legacy_round(src, size):
    # Draw at 4x and downsample for a smooth circular edge.
    big = size * 4
    art = flatten(src).resize((big, big), Image.LANCZOS)
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big - 1, big - 1), fill=255)
    out = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    out.paste(art, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


def main():
    for f in (ICON, MASKABLE):
        if not f.is_file():
            fail("Missing icon source: %s" % f)
    if not RES.is_dir():
        fail("android/app/src/main/res not found - run after 'npx cap add android'")

    icon = square(ICON)
    maskable = square(MASKABLE)

    for dens, px in LEGACY.items():
        d = RES / ("mipmap-" + dens)
        d.mkdir(parents=True, exist_ok=True)
        legacy_square(icon, px).save(d / "ic_launcher.png")
        legacy_round(icon, px).save(d / "ic_launcher_round.png")
    for dens, px in ADAPTIVE.items():
        d = RES / ("mipmap-" + dens)
        d.mkdir(parents=True, exist_ok=True)
        # Maskable art already has the adaptive-icon safe-zone padding.
        maskable.resize((px, px), Image.LANCZOS).save(d / "ic_launcher_foreground.png")

    vals = RES / "values"
    vals.mkdir(parents=True, exist_ok=True)
    (vals / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        '    <color name="ic_launcher_background">%s</color>\n</resources>\n' % BG_HEX,
        encoding="utf-8")

    adaptive_xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '</adaptive-icon>\n')
    any26 = RES / "mipmap-anydpi-v26"
    any26.mkdir(parents=True, exist_ok=True)
    (any26 / "ic_launcher.xml").write_text(adaptive_xml, encoding="utf-8")
    (any26 / "ic_launcher_round.xml").write_text(adaptive_xml, encoding="utf-8")

    # Capacitor's template also ships a vector foreground in drawable-v24; the
    # adaptive XML above no longer references it, remove it so it cannot be picked up.
    stale = RES / "drawable-v24" / "ic_launcher_foreground.xml"
    if stale.is_file():
        stale.unlink()

    # Splash: replace every splash.png variant the template created.
    splashes = sorted(RES.glob("drawable*/splash.png"))
    if not splashes:
        (RES / "drawable").mkdir(parents=True, exist_ok=True)
        splashes = [RES / "drawable" / "splash.png"]
    for sp in splashes:
        try:
            w, h = Image.open(sp).size
        except Exception:
            w = h = 2732
        canvas = Image.new("RGBA", (w, h), BG)
        logo_px = int(min(w, h) * 0.45)
        logo = flatten(icon).resize((logo_px, logo_px), Image.LANCZOS)
        canvas.paste(logo, ((w - logo_px) // 2, (h - logo_px) // 2))
        canvas.convert("RGB").save(sp)

    print("Launcher icons installed for: " + ", ".join(LEGACY))
    print("Splash images replaced: %d" % len(splashes))


if __name__ == "__main__":
    main()
