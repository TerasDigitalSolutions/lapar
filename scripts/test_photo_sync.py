import hashlib
import io
import json
import os
import tempfile
import unittest
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
    def __init__(self, rows, site_status=(200,), patch_rows=None):
        self.rows, self.site = rows, list(site_status)
        self.patch_rows, self.calls = patch_rows, []

    def __call__(self, method, url, headers=None, body=None):
        self.calls.append((method, url, headers, body))
        if method == "GET" and "/rest/v1/items" in url:
            return 200, json.dumps(self.rows).encode()
        if method == "GET" and "/storage/" in url:
            return 200, png(1600, 900)
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


if __name__ == "__main__":
    unittest.main()
