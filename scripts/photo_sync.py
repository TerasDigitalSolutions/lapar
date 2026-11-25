#!/usr/bin/env python3
"""Nightly photo sync: prepare (staging -> app/public/menu) and publish (mark rows, clean staging).

Env: SUPABASE_URL, SUPABASE_SECRET_KEY. Standard library + Pillow only.
"""
import argparse
import hashlib
import io
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageOps

MAX_PX = 800
BUCKET = "menu-staging"
MENU_DIR = Path("app/public/menu")


def auth_headers(key):
    """New sb_secret_ keys go on `apikey` only; legacy JWTs (eyJ...) also need Bearer."""
    h = {"apikey": key}
    if key.startswith("eyJ"):
        h["Authorization"] = f"Bearer {key}"
    return h


def urllib_http(method, url, headers=None, body=None):
    """Default HTTP layer: returns (status, bytes); never raises on HTTP errors."""
    req = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def encode_webp(data):
    """Aspect-preserving resize to at most MAX_PX on the long edge, WebP quality 80."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    img.thumbnail((MAX_PX, MAX_PX), Image.LANCZOS)
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA" if "transparency" in img.info else "RGB")
    out = io.BytesIO()
    img.save(out, "WEBP", quality=80)
    return out.getvalue()


def new_rel_path(shop_id, item_id, webp):
    return f"menu/{shop_id}/{item_id}-{hashlib.sha256(webp).hexdigest()[:8]}.webp"


def object_path(staging_url):
    """Storage object path inside menu-staging, or None if the URL is not one of ours."""
    path = urllib.parse.urlparse(staging_url).path
    marker = f"/{BUCKET}/"
    if marker not in path:
        return None
    return urllib.parse.unquote(path.split(marker, 1)[1]) or None


def find_orphans(menu_dir, referenced, written):
    """Files under menu_dir that no item references and this run did not write."""
    keep = set(referenced) | set(written)
    base = Path(menu_dir).parent
    return sorted(
        p for p in Path(menu_dir).rglob("*")
        if p.is_file() and p.relative_to(base).as_posix() not in keep
    )


class Api:
    def __init__(self, url, key, http=urllib_http):
        self.url, self.http, self.h = url.rstrip("/"), http, auth_headers(key)

    def call(self, method, path, body=None, extra=None, ok=(200, 204)):
        headers = {**self.h, **(extra or {})}
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        status, resp = self.http(method, self.url + path, headers, data)
        if status not in ok:
            raise RuntimeError(f"{method} {path.split('?')[0]} -> HTTP {status}")
        return resp


def prepare(api, root, manifest_path, dry_run=False):
    rows = json.loads(api.call(
        "GET", "/rest/v1/items?select=id,shop_id,photo_url,photo_state&photo_url=not.is.null"))
    staging = [r for r in rows if r["photo_state"] == "staging"]
    referenced = {r["photo_url"] for r in rows if r["photo_state"] == "published"}
    manifest, written = [], set()
    for r in staging:
        status, data = api.http("GET", r["photo_url"], {}, None)
        if status != 200:
            raise RuntimeError(f"download {r['id']} -> HTTP {status}")
        webp = encode_webp(data)
        rel = new_rel_path(r["shop_id"], r["id"], webp)
        print(f"{'would write' if dry_run else 'write'} {rel}")
        if not dry_run:
            dest = root / "app/public" / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(webp)
        written.add(rel)
        manifest.append({"item_id": r["id"], "staging_url": r["photo_url"], "new_path": rel,
                         "object_path": object_path(r["photo_url"])})
    for p in find_orphans(root / MENU_DIR, referenced, written):
        print(f"{'would delete' if dry_run else 'delete'} orphan {p.relative_to(root)}")
        if not dry_run:
            p.unlink()
    if not dry_run:
        Path(manifest_path).write_text(json.dumps(manifest, indent=2))
    return manifest


def publish(api, manifest, site_base, dry_run=False, sleep=time.sleep, tries=10, wait=30):
    if not manifest:
        print("nothing to publish")
        return []
    probe = site_base.rstrip("/") + "/" + manifest[0]["new_path"]
    for i in range(tries):
        if api.http("GET", probe, {}, None)[0] == 200:
            break
        if i < tries - 1:
            sleep(wait)
    else:
        raise RuntimeError(f"site did not serve {probe} with HTTP 200")
    done = []
    for m in manifest:
        q = f"/rest/v1/items?id=eq.{m['item_id']}&photo_url=eq.{urllib.parse.quote(m['staging_url'], safe='')}"
        print(f"{'would publish' if dry_run else 'publish'} {m['item_id']} -> {m['new_path']}")
        if dry_run:
            continue
        got = json.loads(api.call(
            "PATCH", q, {"photo_url": m["new_path"], "photo_state": "published"},
            {"Prefer": "return=representation"}))
        if got:  # empty: owner uploaded a newer photo meanwhile; leave its staging object alone
            done.append(m)
        else:
            print(f"skip {m['item_id']}: row changed since prepare")
    prefixes = [m["object_path"] for m in done if m["object_path"]]
    if prefixes and not dry_run:
        api.call("DELETE", f"/storage/v1/object/{BUCKET}", {"prefixes": prefixes})
    return done


def main(argv=None, http=urllib_http, sleep=time.sleep, root=Path(".")):
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("prepare", "publish"):
        p = sub.add_parser(name)
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--manifest", default="photo-manifest.json")
    sub.choices["publish"].add_argument("--site-base", required=True)
    a = ap.parse_args(argv)
    try:
        api = Api(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"], http)
        if a.cmd == "prepare":
            prepare(api, root, a.manifest, a.dry_run)
        else:
            publish(api, json.loads(Path(a.manifest).read_text()), a.site_base, a.dry_run, sleep)
    except Exception as e:  # message holds only method, path and status: never the key
        print(f"error: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
