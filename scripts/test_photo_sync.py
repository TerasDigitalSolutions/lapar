import hashlib
import io
import json
import os
import tempfile
import unittest
import urllib.parse
from pathlib import Path

from PIL import Image

import photo_sync as ps

SHOP, ITEM = "s1", "i1"
BASE = "https://x.supabase.co"
STAGING = f"{BASE}/storage/v1/object/public/menu-staging/{SHOP}/{ITEM}/abc.webp"


def png(w, h):
    b = io.BytesIO()
    Image.new("RGB", (w, h), "red").save(b, "PNG")
    return b.getvalue()


class Fake:
    """Fake HTTP layer: records calls, answers from handlers."""
    def __init__(self, rows, site_status=(200,), patch_rows=None, cap=None, fail_offset=None, blobs=None):
        self.rows, self.site = rows, list(site_status)
        self.patch_rows, self.calls = patch_rows, []
        self.cap, self.fail_offset, self.blobs = cap, fail_offset, blobs or {}

    def __call__(self, method, url, headers=None, body=None):
        self.calls.append((method, url, headers, body))
        if method == "GET" and "/rest/v1/items" in url:
            q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
            off, lim = int(q.get("offset", 0)), int(q.get("limit", 1000))
            if off == self.fail_offset:
                return 500, b""
            return 200, json.dumps(self.rows[off:off + min(lim, self.cap or lim)]).encode()
        if method == "GET" and "/storage/" in url:
            return 200, self.blobs.get(url, png(1600, 900))
        if method == "GET":  # site probe
            return (self.site.pop(0) if len(self.site) > 1 else self.site[0]), b""
        if method == "PATCH":
            return 200, json.dumps([{"id": ITEM}] if self.patch_rows is None else self.patch_rows).encode()
        return 200, b"[]"

    def writes(self):
        return [c for c in self.calls if c[0] in ("PATCH", "DELETE")]


class Unit(unittest.TestCase):
    def test_headers(self):
        self.assertEqual(ps.auth_headers("sb_secret_x"), {"apikey": "sb_secret_x"})
        self.assertEqual(ps.auth_headers("eyJabc"), {"apikey": "eyJabc", "Authorization": "Bearer eyJabc"})

    def test_resize_keeps_aspect_and_caps(self):
        img = Image.open(io.BytesIO(ps.encode_webp(png(1600, 900))))
        self.assertEqual((img.format, img.size), ("WEBP", (800, 450)))
        self.assertEqual(Image.open(io.BytesIO(ps.encode_webp(png(300, 200)))).size, (300, 200))

    def test_naming(self):
        data = b"abc"
        self.assertEqual(ps.new_rel_path("s", "i", data),
                         f"menu/s/i-{hashlib.sha256(data).hexdigest()[:8]}.webp")

    def test_object_path(self):
        self.assertEqual(ps.object_path(STAGING + "?t=1"), f"{SHOP}/{ITEM}/abc.webp")
        self.assertIsNone(ps.object_path("https://example.com/a.jpg"))

    def test_orphans(self):
        with tempfile.TemporaryDirectory() as d:
            menu = Path(d) / "menu"
            (menu / "s").mkdir(parents=True)
            for n in ("keep", "new", "gone"):
                (menu / "s" / f"{n}.webp").write_bytes(b"x")
            orphans = ps.find_orphans(menu, {"menu/s/keep.webp"}, {"menu/s/new.webp"})
            self.assertEqual([p.name for p in orphans], ["gone.webp"])

    def test_jwt_key_gets_bearer(self):
        http = Fake([])
        ps.Api(BASE, "eyJkey", http).call("GET", "/rest/v1/items")
        self.assertEqual(http.calls[0][2]["Authorization"], "Bearer eyJkey")


class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        menu = self.root / "app/public/menu/s1"
        menu.mkdir(parents=True)
        (menu / "old.webp").write_bytes(b"x")
        (menu / "old2.webp").write_bytes(b"x")
        self.rows = [
            {"id": ITEM, "shop_id": SHOP, "photo_url": STAGING, "photo_state": "staging"},
            {"id": "i2", "shop_id": SHOP, "photo_url": "menu/s1/old2.webp", "photo_state": "published"},
        ]
        self.manifest = str(self.root / "m.json")

    def tearDown(self):
        self.tmp.cleanup()

    def run_main(self, cmd, http, *extra):
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"] = BASE, "sb_secret_SECRET"
        return ps.main([cmd, "--manifest", self.manifest, *extra], http, lambda s: None, self.root)

    def test_prepare_then_publish(self):
        http = Fake(self.rows)
        self.assertEqual(self.run_main("prepare", http), 0)
        m = json.loads(Path(self.manifest).read_text())
        self.assertEqual(len(m), 1)
        out = self.root / "app/public" / m[0]["new_path"]
        self.assertEqual(Image.open(out).size, (800, 450))
        self.assertEqual(m[0]["object_path"], f"{SHOP}/{ITEM}/abc.webp")
        self.assertFalse((self.root / "app/public/menu/s1/old.webp").exists())  # orphan
        self.assertTrue((self.root / "app/public/menu/s1/old2.webp").exists())  # referenced
        self.assertEqual(http.writes(), [])

        self.assertEqual(self.run_main("publish", http, "--site-base", "https://site/lapar"), 0)
        patch, delete = http.writes()
        self.assertIn(f"id=eq.{ITEM}&photo_url=eq.https%3A%2F%2Fx.supabase.co", patch[1])
        self.assertEqual(json.loads(patch[3]), {"photo_url": m[0]["new_path"], "photo_state": "published"})
        self.assertEqual(patch[2]["apikey"], "sb_secret_SECRET")
        self.assertNotIn("Authorization", patch[2])
        self.assertTrue(delete[1].endswith("/storage/v1/object/menu-staging"))
        self.assertEqual(json.loads(delete[3]), {"prefixes": [f"{SHOP}/{ITEM}/abc.webp"]})

    def test_prepare_dry_run_writes_nothing(self):
        self.assertEqual(self.run_main("prepare", Fake(self.rows), "--dry-run"), 0)
        self.assertFalse(Path(self.manifest).exists())
        self.assertEqual(len(list((self.root / "app/public/menu").rglob("*.webp"))), 2)

    def test_publish_dry_run_writes_nothing(self):
        http = Fake(self.rows)
        self.run_main("prepare", http)
        self.assertEqual(self.run_main("publish", http, "--site-base", "https://site", "--dry-run"), 0)
        self.assertEqual(http.writes(), [])

    def test_nothing_marked_when_site_fails(self):
        http = Fake(self.rows, site_status=(404,))
        self.run_main("prepare", http)
        self.assertEqual(self.run_main("publish", http, "--site-base", "https://site"), 1)
        self.assertEqual(http.writes(), [])

    def test_site_retries_until_200(self):
        http = Fake(self.rows, site_status=(404, 404, 200))
        self.run_main("prepare", http)
        self.assertEqual(self.run_main("publish", http, "--site-base", "https://site"), 0)
        self.assertEqual(len(http.writes()), 2)

    def test_changed_row_not_published_and_staging_kept(self):
        http = Fake(self.rows, patch_rows=[])
        self.run_main("prepare", http)
        self.assertEqual(self.run_main("publish", http, "--site-base", "https://site"), 0)
        self.assertEqual([c[0] for c in http.writes()], ["PATCH"])  # no DELETE

    def test_patch_failure_exits_nonzero_and_deletes_nothing(self):
        class Bad(Fake):
            def __call__(self, method, *a, **k):
                if method == "PATCH":
                    return 500, b""
                return super().__call__(method, *a, **k)
        http = Bad(self.rows)
        self.run_main("prepare", http)
        self.assertEqual(self.run_main("publish", http, "--site-base", "https://site"), 1)
        self.assertFalse(any(c[0] == "DELETE" for c in http.calls))

    def staging_row(self, i, url=None):
        u = f"{BASE}/storage/v1/object/public/menu-staging/{SHOP}/{i}/a.png"
        return {"id": i, "shop_id": SHOP, "photo_url": url or u, "photo_state": "staging"}

    def published_rows(self, n):
        return [{"id": f"p{i}", "shop_id": SHOP, "photo_url": f"menu/s1/p{i}.webp",
                 "photo_state": "published"} for i in range(n)]

    def test_pagination_collects_every_row_despite_server_cap(self):
        rows = self.published_rows(1234)
        got = ps.Api(BASE, "sb_secret_x", Fake(rows, cap=1000)).list_all("/rest/v1/items?select=id")
        self.assertEqual(len(got), 1234)

    def test_orphan_deletion_keeps_published_rows_beyond_first_page(self):
        n = ps.PAGE + 10
        menu = self.root / "app/public/menu/s1"
        rows = self.published_rows(n)
        for r in rows:
            (self.root / "app/public" / r["photo_url"]).write_bytes(b"x")
        self.assertEqual(self.run_main("prepare", Fake(rows, cap=ps.PAGE)), 0)
        self.assertTrue((menu / f"p{n - 1}.webp").exists())
        self.assertFalse((menu / "old.webp").exists())  # genuine orphan still goes

    def test_incomplete_listing_deletes_nothing(self):
        rows = self.published_rows(ps.PAGE + 5)
        self.assertEqual(self.run_main("prepare", Fake(rows, fail_offset=ps.PAGE)), 1)
        self.assertTrue((self.root / "app/public/menu/s1/old.webp").exists())
        self.assertFalse(Path(self.manifest).exists())

    def test_empty_listing_deletes_nothing(self):
        self.assertEqual(self.run_main("prepare", Fake([])), 0)
        self.assertTrue((self.root / "app/public/menu/s1/old.webp").exists())

    def test_url_allowlist(self):
        def ok(u, shop=SHOP, item=ITEM):
            return ps.allowed_staging_url(BASE, shop, item, u)
        self.assertTrue(ok(STAGING))
        self.assertFalse(ok("http://169.254.169.254/latest/meta-data"))
        self.assertFalse(ok("https://evil.example/storage/v1/object/public/menu-staging/s1/i1/a.png"))
        self.assertFalse(ok(STAGING, shop="s2"))  # someone else's shop
        self.assertFalse(ok(STAGING, item="i2"))  # someone else's item
        self.assertFalse(ok(f"{BASE}/storage/v1/object/public/menu-staging/s1/i1/../i2/a.png"))
        self.assertFalse(ok(f"{BASE}/storage/v1/object/public/menu-staging/s1/i1/%2e%2e/i2/a.png"))
        self.assertFalse(ok(f"{BASE}.evil.com/storage/v1/object/public/menu-staging/s1/i1/a.png"))
        self.assertFalse(ok(f"{BASE}/storage/v1/object/public/menu/s1/i1/a.png"))
        self.assertFalse(ok(None))

    def test_disallowed_url_is_not_fetched(self):
        http = Fake([self.staging_row("i1", "http://169.254.169.254/x")])
        self.assertEqual(self.run_main("prepare", http), 0)
        self.assertFalse(any("169.254" in c[1] for c in http.calls))
        self.assertEqual(json.loads(Path(self.manifest).read_text()), [])

    def test_one_bad_row_does_not_stop_the_rest(self):
        bad, good = self.staging_row("bad"), self.staging_row("good")
        http = Fake([bad, good], blobs={bad["photo_url"]: b"<html>not an image</html>"})
        self.assertEqual(self.run_main("prepare", http), 1)
        m = json.loads(Path(self.manifest).read_text())
        self.assertEqual([x["item_id"] for x in m], ["good"])
        self.assertEqual(http.writes(), [])  # nothing marked published

    def test_oversize_download_is_a_row_failure(self):
        row = self.staging_row("big")
        http = Fake([row], blobs={row["photo_url"]: b"x" * (ps.MAX_BYTES + 1)})
        self.assertEqual(self.run_main("prepare", http), 1)
        self.assertEqual(json.loads(Path(self.manifest).read_text()), [])

    def test_pixel_cap_rejects_decompression_bomb(self):
        old = ps.MAX_PIXELS
        ps.MAX_PIXELS = 1000
        try:
            with self.assertRaises(Exception):
                ps.encode_webp(png(200, 200))
        finally:
            ps.MAX_PIXELS = old


if __name__ == "__main__":
    unittest.main()
