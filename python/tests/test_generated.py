import inspect
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

from lilambd import PRODUCTS, Client
from lilambd._generated import NAMESPACES, ROUTES

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT.parent / "spec" / "catalog.json"


def load_catalog():
    if not CATALOG.exists():
        pytest.skip("spec/catalog.json not available")
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def test_every_method_maps_to_catalog_route():
    catalog = load_catalog()
    real = {(p["id"], r["path"]) for p in catalog["products"] for r in p["routes"]}
    generated = {(pid, path) for _, _, pid, path in ROUTES}
    assert generated <= real
    assert generated == real  # and every catalog route is covered
    assert len(ROUTES) == len(real) == 170
    assert len(PRODUCTS) == len(catalog["products"]) == 27


def test_methods_exist_and_are_unique():
    c = Client()
    seen = set()
    for attr, method, pid, path in ROUTES:
        ns = getattr(c, attr)
        assert ns.product == pid
        assert callable(getattr(ns, method))
        assert (attr, method) not in seen
        seen.add((attr, method))
    assert set(NAMESPACES) == {a for a, *_ in ROUTES}


def test_every_method_builds_its_route():
    """Call each method against a stub transport and check the URL it builds."""
    c = Client(base_url="https://x.test")
    captured = []

    def fake_get(product, route, **params):
        captured.append(c.build_url(product, route, **params))
        return None

    c.get = fake_get  # type: ignore[assignment]
    for attr, method, pid, path in ROUTES:
        fn = getattr(getattr(c, attr), method)
        sig = inspect.signature(fn)
        kwargs = {
            name: "v1"
            for name, p in sig.parameters.items()
            if p.kind is p.POSITIONAL_OR_KEYWORD
        }
        fn(**kwargs)
        expected = "https://x.test/" + pid + re.sub(r"\{[^}]+\}", "v1", path)
        assert captured[-1] == expected, (attr, method)


def test_named_examples():
    c = Client()
    assert callable(c.airports.search)
    assert callable(c.airports.get_by_code)
    assert "{code}" in ROUTES[[r[:2] for r in ROUTES].index(("airports", "get_by_code"))][3]


def test_prices_match_catalog():
    catalog = load_catalog()
    for p in catalog["products"]:
        meta = PRODUCTS[p["id"]]
        assert meta["price_atomic"] == str(p["price_atomic"])
        assert meta["price_usd"] == int(p["price_atomic"]) / 1_000_000
        assert meta["free_routes"] == sorted(p.get("free_routes") or [])


def test_generated_file_is_up_to_date(tmp_path):
    load_catalog()
    target = ROOT / "lilambd" / "_generated.py"
    before = target.read_text(encoding="utf-8")
    subprocess.run([sys.executable, str(ROOT / "scripts" / "generate.py")], check=True, capture_output=True)
    assert target.read_text(encoding="utf-8") == before
