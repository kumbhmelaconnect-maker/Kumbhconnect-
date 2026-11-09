
#!/usr/bin/env python3
"""
Install KumbhConnect launcher icons and splash images into the generated
Capacitor Android project.

Run AFTER:
    npx cap add android
    npx cap sync android

Generated resources:
  - mipmap-*/ic_launcher.png
  - mipmap-*/ic_launcher_round.png
  - mipmap-*/ic_launcher_foreground.png
  - values/ic_launcher_background.xml
  - mipmap-anydpi-v26/ic_launcher.xml
  - mipmap-anydpi-v26/ic_launcher_round.xml
  - drawable*/splash.png

Source files:
  - icon-512.png
  - icon-maskable-512.png

This script does not modify Firebase configuration, Firestore Rules,
application signing configuration, or production endpoints.
"""

import sys
import os
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFile


# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------

ROOT = Path(__file__).resolve().parents[2]

RES = ROOT / "android" / "app" / "src" / "main" / "res"

ICON = ROOT / "icon-512.png"
MASKABLE = ROOT / "icon-maskable-512.png"

BG_HEX = "#FFFFFF"
BG = (255, 255, 255, 255)

LEGACY = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

ADAPTIVE = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}

# Support both old and new Pillow versions.
RESAMPLING = getattr(Image, "Resampling", Image)
LANCZOS = RESAMPLING.LANCZOS

# Do not silently accept truncated source images.
ImageFile.LOAD_TRUNCATED_IMAGES = False


# ---------------------------------------------------------
# ERROR HANDLING
# ---------------------------------------------------------

def fail(message):
    print("::error::" + str(message))
    sys.exit(1)


def info(message):
    print("::notice::" + str(message))


# ---------------------------------------------------------
# SAFE FILE WRITING
# ---------------------------------------------------------

def atomic_write(path, content):
    """
    Write text to a temporary file and replace the destination.
    """

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            newline="\n",
            dir=path.parent,
            prefix=path.name + ".",
            suffix=".tmp",
            delete=False,
        ) as tmp:
            temp_path = Path(tmp.name)
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())

        os.replace(temp_path, path)

    except Exception:
        if temp_path and temp_path.exists():
            temp_path.unlink()
        raise


def atomic_save_png(image, path, mode=None):
    """
    Save PNG safely without leaving partially written resources.
    """

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            dir=path.parent,
            prefix=path.stem + ".",
            suffix=".tmp.png",
            delete=False,
        ) as tmp:
            temp_path = Path(tmp.name)

        output = image.convert(mode) if mode else image

        output.save(
            temp_path,
            format="PNG",
            optimize=True,
        )

        # Confirm the generated image can be decoded.
        with Image.open(temp_path) as check:
            check.verify()

        os.replace(temp_path, path)

    except Exception:
        if temp_path and temp_path.exists():
            temp_path.unlink()
        raise


# ---------------------------------------------------------
# IMAGE VALIDATION
# ---------------------------------------------------------

def load_source(path):
    """
    Load and fully decode a source PNG.
    """

    path = Path(path)

    if not path.is_file():
        fail("Missing icon source: %s" % path)

    try:
        with Image.open(path) as original:

            if original.format != "PNG":
                fail("Icon source must be PNG: %s" % path)

            if original.width < 1 or original.height < 1:
                fail("Invalid image dimensions: %s" % path)

            if original.width > 8192 or original.height > 8192:
                fail("Icon image dimensions exceed 8192px: %s" % path)

            original.load()
            image = original.convert("RGBA")

        return image

    except Exception as exc:
        fail("Unable to read icon source %s: %s" % (path, exc))


def square(image):
    """
    Center a non-square image on a white square canvas.
    """

    image = image.convert("RGBA")

    if image.width == image.height:
        return image.copy()

    side = max(image.size)

    canvas = Image.new(
        "RGBA",
        (side, side),
        BG,
    )

    x = (side - image.width) // 2
    y = (side - image.height) // 2

    canvas.alpha_composite(
        image,
        dest=(x, y),
    )

    return canvas


def flatten(image):
    """
    Composite transparent pixels over the configured background.
    """

    base = Image.new(
        "RGBA",
        image.size,
        BG,
    )

    base.alpha_composite(image)

    return base


# ---------------------------------------------------------
# ICON GENERATION
# ---------------------------------------------------------

def legacy_square(source, size):
    """
    Generate a traditional square launcher icon.
    """

    return flatten(source).resize(
        (size, size),
        LANCZOS,
    )


def legacy_round(source, size):
    """
    Generate a circular legacy launcher icon with antialiased edges.
    """

    big = size * 4

    artwork = flatten(source).resize(
        (big, big),
        LANCZOS,
    )

    mask = Image.new(
        "L",
        (big, big),
        0,
    )

    ImageDraw.Draw(mask).ellipse(
        (0, 0, big - 1, big - 1),
        fill=255,
    )

    output = Image.new(
        "RGBA",
        (big, big),
        (0, 0, 0, 0),
    )

    output.paste(
        artwork,
        (0, 0),
        mask,
    )

    return output.resize(
        (size, size),
        LANCZOS,
    )


def generate_legacy_icons(source):
    """
    Generate mdpi through xxxhdpi legacy launcher icons.
    """

    generated = []

    for density, pixels in LEGACY.items():

        directory = RES / ("mipmap-" + density)
        directory.mkdir(parents=True, exist_ok=True)

        square_icon = legacy_square(source, pixels)
        round_icon = legacy_round(source, pixels)

        square_path = directory / "ic_launcher.png"
        round_path = directory / "ic_launcher_round.png"

        atomic_save_png(square_icon, square_path)
        atomic_save_png(round_icon, round_path)

        generated.extend([
            square_path,
            round_path,
        ])

    return generated


def generate_adaptive_icons(source):
    """
    Generate adaptive foreground resources.
    """

    generated = []

    for density, pixels in ADAPTIVE.items():

        directory = RES / ("mipmap-" + density)
        directory.mkdir(parents=True, exist_ok=True)

        foreground = source.resize(
            (pixels, pixels),
            LANCZOS,
        )

        foreground_path = (
            directory / "ic_launcher_foreground.png"
        )

        atomic_save_png(
            foreground,
            foreground_path,
        )

        generated.append(foreground_path)

    return generated


# ---------------------------------------------------------
# ADAPTIVE ICON XML
# ---------------------------------------------------------

def generate_adaptive_xml():
    """
    Generate adaptive icon background and launcher definitions.
    """

    values = RES / "values"
    values.mkdir(parents=True, exist_ok=True)

    background_xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<resources>\n'
        '    <color name="ic_launcher_background">'
        + BG_HEX +
        '</color>\n'
        '</resources>\n'
    )

    background_path = (
        values / "ic_launcher_background.xml"
    )

    atomic_write(
        background_path,
        background_xml,
    )

    adaptive_xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon '
        'xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background '
        'android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground '
        'android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '</adaptive-icon>\n'
    )

    anydpi = RES / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)

    generated = [background_path]

    for filename in (
        "ic_launcher.xml",
        "ic_launcher_round.xml",
    ):

        path = anydpi / filename

        atomic_write(
            path,
            adaptive_xml,
        )

        generated.append(path)

    # Remove the old vector foreground only when present.
    stale = (
        RES
        / "drawable-v24"
        / "ic_launcher_foreground.xml"
    )

    if stale.is_file():
        stale.unlink()
        info("Removed obsolete vector launcher foreground.")

    return generated


# ---------------------------------------------------------
# SPLASH IMAGE GENERATION
# ---------------------------------------------------------

def get_splash_dimensions(path):
    """
    Preserve the dimensions of each Capacitor splash resource.
    """

    try:
        with Image.open(path) as image:

            if image.format != "PNG":
                fail("Splash resource is not PNG: %s" % path)

            image.verify()

        with Image.open(path) as image:
            width, height = image.size

        if width < 1 or height < 1:
            fail("Invalid splash dimensions: %s" % path)

        return width, height

    except Exception as exc:
        fail("Cannot inspect splash resource %s: %s" % (path, exc))


def generate_splash(source):
    """
    Replace existing drawable*/splash.png resources.

    If the Capacitor template has no splash.png, create one
    in drawable/ using a 2732 x 2732 canvas.
    """

    splashes = sorted(
        RES.glob("drawable*/splash.png")
    )

    if not splashes:

        directory = RES / "drawable"
        directory.mkdir(parents=True, exist_ok=True)

        splashes = [
            directory / "splash.png"
        ]

        dimensions = {
            splashes[0]: (2732, 2732)
        }

    else:

        dimensions = {
            path: get_splash_dimensions(path)
            for path in splashes
        }

    generated = []

    for splash_path in splashes:

        width, height = dimensions[splash_path]

        canvas = Image.new(
            "RGBA",
            (width, height),
            BG,
        )

        logo_size = max(
            1,
            int(min(width, height) * 0.45),
        )

        logo = flatten(source).resize(
            (logo_size, logo_size),
            LANCZOS,
        )

        x = (width - logo_size) // 2
        y = (height - logo_size) // 2

        canvas.alpha_composite(
            logo,
            dest=(x, y),
        )

        atomic_save_png(
            canvas,
            splash_path,
            mode="RGB",
        )

        generated.append(splash_path)

    return generated


# ---------------------------------------------------------
# RESOURCE VERIFICATION
# ---------------------------------------------------------

def verify_resources():
    """
    Confirm all expected resources exist and are valid.
    """

    required = []

    for density in LEGACY:

        directory = RES / ("mipmap-" + density)

        required.extend([
            directory / "ic_launcher.png",
            directory / "ic_launcher_round.png",
        ])

    for density in ADAPTIVE:

        directory = RES / ("mipmap-" + density)

        required.append(
            directory / "ic_launcher_foreground.png"
        )

    required.extend([
        RES / "values" / "ic_launcher_background.xml",
        RES / "mipmap-anydpi-v26" / "ic_launcher.xml",
        RES / "mipmap-anydpi-v26" / "ic_launcher_round.xml",
    ])

    required.extend(
        sorted(RES.glob("drawable*/splash.png"))
    )

    missing = [
        path for path in required
        if not path.is_file()
    ]

    if missing:
        fail(
            "Generated Android resources are missing: "
            + ", ".join(str(path) for path in missing)
        )

    # Validate every generated PNG.
    for path in required:

        if path.suffix.lower() != ".png":
            continue

        try:
            with Image.open(path) as image:

                if image.format != "PNG":
                    fail("Generated resource is not PNG: %s" % path)

                image.verify()

        except Exception as exc:
            fail(
                "Generated PNG verification failed for %s: %s"
                % (path, exc)
            )

    return len(required)


# ---------------------------------------------------------
# MAIN
# ---------------------------------------------------------

def main():

    print("KumbhConnect Android icon generation started.")

    # Verify Android project exists.
    if not RES.is_dir():
        fail(
            "Android resources directory not found: %s. "
            "Run after 'npx cap add android' and 'npx cap sync android'."
            % RES
        )

    # Load and validate source images.
    icon = square(
        load_source(ICON)
    )

    maskable = square(
        load_source(MASKABLE)
    )

    generated = []

    # Generate all resources.
    generated.extend(
        generate_legacy_icons(icon)
    )

    generated.extend(
        generate_adaptive_icons(maskable)
    )

    generated.extend(
        generate_adaptive_xml()
    )

    splash_files = generate_splash(icon)
    generated.extend(splash_files)

    # Final verification.
    verified_count = verify_resources()

    print("")
    print("KumbhConnect Android resources generated successfully.")
    print("Legacy densities: " + ", ".join(LEGACY.keys()))
    print("Adaptive densities: " + ", ".join(ADAPTIVE.keys()))
    print("Splash images replaced: %d" % len(splash_files))
    print("Resources verified: %d" % verified_count)
    print("Total generated files: %d" % len(generated))


if __name__ == "__main__":

    try:
        main()

    except KeyboardInterrupt:
        fail("Icon generation interrupted.")

    except Exception as exc:
        fail(
            "Unexpected icon generation failure: "
            + str(exc)
        )
