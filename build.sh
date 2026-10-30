#!/usr/bin/env bash
# Package src/ into the hosted KaiOS sideload source.
# Rebuilds Apps-directory/Deako-Lights/{application.zip, manifest.webmanifest},
# then updates packaged_size/size in update.webmanifest and sha256 in webapps.json.
set -euo pipefail
cd "$(dirname "$0")"

SRC=src
APP=Apps-directory/Deako-Lights
FILES=(manifest.webmanifest index.html style.css app.js api.js icons/icon_56.png icons/icon_112.png)

python3 - "$SRC" "$APP/application.zip" "${FILES[@]}" <<'PY'
import sys, zipfile, os
src, out, *files = sys.argv[1:]
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(os.path.join(src, f), f)
assert zipfile.ZipFile(out).testzip() is None
assert "manifest.webmanifest" in zipfile.ZipFile(out).namelist()
print("built", out)
PY

# Opt-in: SIGN=1 ./build.sh adds a self-signed zigbert signature (see sign.py).
if [[ "${SIGN:-0}" == "1" ]]; then
  python3 sign.py "$APP/application.zip"
fi

cp "$SRC/manifest.webmanifest" "$APP/manifest.webmanifest"
SIZE=$(stat -c%s "$APP/application.zip")
SHA=$(sha256sum "$APP/application.zip" | cut -d' ' -f1)

python3 - "$APP/update.webmanifest" "$SIZE" <<'PY'
import json, sys
p, size = sys.argv[1], int(sys.argv[2])
m = json.load(open(p)); m["packaged_size"] = size; m["size"] = size
json.dump(m, open(p, "w"), indent=2); open(p, "a").write("\n")
PY

python3 - webapps.json "$SHA" <<'PY'
import json, sys
p, sha = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d["apps"][0]["sha256"] = sha
json.dump(d, open(p, "w"), indent=2); open(p, "a").write("\n")
PY

echo "size=$SIZE sha=$SHA"
echo "done. commit + push to update the live GitHub Pages source."
