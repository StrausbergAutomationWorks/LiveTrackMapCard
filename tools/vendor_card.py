"""Put a RELEASED Live Track Map Card into a Live Track integration (backlog 291, SSOT 67.5).

    python tools/vendor_card.py <integration clone> vX.Y.Z

Downloads the release's live-track-map-card.js and its .sha256 with `gh`, checks the hash,
checks that line 1 is a plain release matching the tag, and writes
custom_components/<domain>/frontend/live-track-map-card.js.

Refuses: a tag that is not vX.Y.Z; a hash mismatch; a header that is missing, a prerelease,
.dirty, or another version; any other file in frontend/ (a .gz or .br beside the card is
served in preference to it, backlog 166). Writes nothing on refusal. Does not commit: the
integration's own chat commits and deploys.
"""
import hashlib
import pathlib
import re
import subprocess
import sys
import tempfile

REPO = "StrausbergAutomationWorks/LiveTrackMapCard"
CARD = "live-track-map-card.js"
HEADER = re.compile(rb"^/\*! live-track-map-card (\S+) \*/")
RELEASE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\+[0-9a-f]{4,40}$")


def refuse(msg):
    sys.exit("REFUSED: " + msg)


def main(clone, tag):
    if not re.fullmatch(r"v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", tag):
        refuse(f"{tag!r} is not a release tag vX.Y.Z")
    cc = pathlib.Path(clone) / "custom_components"
    comps = [p for p in cc.iterdir() if p.is_dir() and not p.name.startswith((".", "__"))] if cc.is_dir() else []
    if len(comps) != 1:
        refuse(f"expected one integration under {cc}, found {[p.name for p in comps]}")
    frontend = comps[0] / "frontend"
    extra = [p.name for p in frontend.iterdir() if p.name != CARD] if frontend.is_dir() else []
    if extra:
        refuse(f"{frontend} holds other files {extra}; the card must be alone there (a .gz or .br is served first)")
    with tempfile.TemporaryDirectory() as tmp:
        r = subprocess.run(["gh", "release", "download", tag, "-R", REPO, "-p", CARD, "-p", CARD + ".sha256",
                            "-D", tmp], capture_output=True, text=True)
        if r.returncode:
            refuse(f"gh release download {tag}: {r.stderr.strip()}")
        data = (pathlib.Path(tmp) / CARD).read_bytes()
        want = (pathlib.Path(tmp) / (CARD + ".sha256")).read_text(encoding="ascii").split()[0]
    got = hashlib.sha256(data).hexdigest()
    if got != want:
        refuse(f"SHA-256 {got} does not match the release's {want}")
    m = HEADER.match(data)
    version = m.group(1).decode() if m else None
    if not version or not RELEASE.match(version) or version.split("+")[0] != tag[1:]:
        refuse(f"line 1 says {version!r}: not the plain release {tag[1:]}+<commit>")
    frontend.mkdir(exist_ok=True)
    (frontend / CARD).write_bytes(data)
    print(f"{comps[0].name}: {CARD} {version}, {len(data)} bytes, sha256 {got[:12]}... written to {frontend}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
