#!/usr/bin/env python3
"""Package Flyby into a distributable, load-unpacked-ready zip.

Produces ../flyby-<version>.zip containing everything Chrome needs (and the
setup docs), nested under a top-level `flyby/` folder so it unzips cleanly.

Run:  python3 tools/build_zip.py
"""

import json
import os
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIX = "flyby"  # top-level folder inside the archive

INCLUDE_FILES = ["manifest.json", "README.md", "INSTALL.md", "LICENSE"]
INCLUDE_DIRS = ["src", "icons"]
SKIP = {".DS_Store", "Thumbs.db"}


def main():
    version = json.load(open(os.path.join(ROOT, "manifest.json")))["version"]
    out = os.path.join(ROOT, f"flyby-{version}.zip")
    if os.path.exists(out):
        os.remove(out)

    count = 0
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in INCLUDE_FILES:
            path = os.path.join(ROOT, name)
            if os.path.exists(path):
                z.write(path, f"{PREFIX}/{name}")
                count += 1
        for d in INCLUDE_DIRS:
            for base, _, files in os.walk(os.path.join(ROOT, d)):
                for fn in sorted(files):
                    if fn in SKIP:
                        continue
                    full = os.path.join(base, fn)
                    rel = os.path.relpath(full, ROOT)
                    z.write(full, f"{PREFIX}/{rel}")
                    count += 1

    size = os.path.getsize(out)
    print(f"Built {os.path.relpath(out, ROOT)}  ({count} files, {size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
