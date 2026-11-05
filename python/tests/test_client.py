import base64
import json

import pytest

import lilambd
from lilambd import BadRequest, Client, LilambdError, NotFound, PaymentRequired

from .conftest import REQUIREMENTS


def test_build_url_basic():
    c = Client()
    assert c.build_url("airports", "/search", q="tokyo", limit=5) == \
        "https://api.lilambd.com/airports/search?q=tokyo&limit=5"


def test_build_url_placeholder_and_encoding():
    c = Client(base_url="https://example.test/")
    assert c.build_url("airports", "/{code}", code="HND") == "https://example.test/airports/HND"
    url = c.build_url("colors", "/{name_or_hex}", name_or_hex="#ff0000", sample=1)
    assert url == "https://example.test/colors/%23ff0000?sample=1"
    url = c.build_url("jp-health", "/hospitals/{hospital_id}/mdc", hospital_id="a/b")
    assert url.endswith("/jp-health/hospitals/a%2Fb/mdc")


def test_build_url_keyword_alias_bool_and_none():
    c = Client()
    url = c.build_url("units", "/convert", from_="m", to="ft", value=3, strict=True, skip=None)
    assert url == "https://api.lilambd.com/units/convert?from=m&to=ft&value=3&strict=true"


def test_missing_placeholder_raises():
    with pytest.raises(BadRequest):
        Client().build_url("airports", "/{code}")


def test_generic_get_url(server):
    c = Client(base_url=server.url, payment_signer=lambda r: "sig")
    data = c.get("airports", "/{code}", code="HND")
    assert data["paid"] is True
    assert server.requests[-1]["path"] == "/airports/HND"


def test_402_parses_payment_required(server):
    c = Client(base_url=server.url)
    with pytest.raises(PaymentRequired) as ei:
        c.airports.search(q="tokyo")
    err = ei.value
    assert err.status == 402
    assert err.amount == "5000"
    assert err.price_usd == pytest.approx(0.005)
    assert err.pay_to == err.payTo == "0x000000000000000000000000000000000000dEaD"
    assert err.asset == REQUIREMENTS["accepts"][0]["asset"]
    assert err.network == "eip155:8453"
    assert err.resource == "http://fake/airports/HND"
    assert err.x402_version == 2
    assert err.requirements == REQUIREMENTS
    assert isinstance(err, LilambdError)
    assert "0.005" in str(err)
    assert len(server.requests) == 1


def test_402_falls_back_to_json_body():
    err = PaymentRequired("x", requirements={"accepts": [{"amount": "50000", "network": "n"}]})
    assert err.price_usd == pytest.approx(0.05)
    assert PaymentRequired("x").price_usd is None


def test_signer_retry_sends_payment_signature(server):
    seen = []

    def signer(requirements):
        seen.append(requirements)
        return "c2lnbmVk"

    c = Client(base_url=server.url, payment_signer=signer)
    resp = c.request("airports", "/search", q="tokyo")
    assert resp.json()["paid"] is True
    assert seen == [REQUIREMENTS]
    assert len(server.requests) == 2
    first, second = server.requests
    assert "payment-signature" not in first["headers"]
    assert second["headers"]["payment-signature"] == "c2lnbmVk"
    assert second["query"] == {"q": "tokyo"}
    assert resp.payment_response == {"success": True, "transaction": "0xabc", "network": "eip155:8453"}


def test_legacy_x_payment_header(server):
    c = Client(base_url=server.url, payment_signer=lambda r: "abc", payment_header="X-PAYMENT")
    assert c.get("airports", "/search")["paid"] is True
    assert server.requests[-1]["headers"]["x-payment"] == "abc"


def test_rejected_payment_raises(server):
    c = Client(base_url=server.url, payment_signer=lambda r: "reject")
    with pytest.raises(PaymentRequired) as ei:
        c.get("airports", "/search")
    assert ei.value.message == "invalid payment"
    assert len(server.requests) == 2


def test_sample_flag(server):
    c = Client(base_url=server.url)
    data = c.airports.get_by_code(code="HND", sample=True)
    assert data["sample"] is True
    assert server.requests[-1]["query"] == {"sample": "1"}
    assert c.sample("airports", "/search", q="x")["rows"] == [1, 2, 3]
    assert server.requests[-1]["query"] == {"q": "x", "sample": "1"}


def test_free_route_no_payment(server):
    c = Client(base_url=server.url)
    assert c.koyomi.helplines()["free"] is True
    assert c.security.stats()["free"] is True


def test_rapidapi_headers(server):
    c = Client(base_url=server.url, rapidapi_key="KEY123", rapidapi_host="lilambd.p.rapidapi.com",
               payment_signer=lambda r: pytest.fail("signer must not be used"))
    data = c.airports.search(q="tokyo")
    assert data["mode"] == "rapidapi"
    h = server.requests[-1]["headers"]
    assert h["x-rapidapi-key"] == "KEY123"
    assert h["x-rapidapi-host"] == "lilambd.p.rapidapi.com"
    assert "payment-signature" not in h


def test_rapidapi_default_base_url():
    c = Client(rapidapi_key="k", rapidapi_host="lilambd.p.rapidapi.com")
    assert c.base_url == "https://lilambd.p.rapidapi.com"


def test_error_mapping(server):
    c = Client(base_url=server.url)
    with pytest.raises(NotFound):
        c.get("missing", "/x")
    with pytest.raises(BadRequest):
        c.get("bad", "/x")
    with pytest.raises(LilambdError) as ei:
        c.get("boom", "/x")
    assert ei.value.status == 500


def test_network_error():
    c = Client(base_url="http://127.0.0.1:9", timeout=2)
    with pytest.raises(LilambdError):
        c.get("airports", "/search")


def test_discovery(server):
    c = Client(base_url=server.url)
    assert c.health()["free"] is True
    assert c.index()["path"] == "/"
    assert c.llms_txt().startswith("# Lilambd")


def test_header_codec_roundtrip():
    payload = {"x402Version": 2, "payload": {"signature": "0x1"}}
    enc = lilambd.encode_payment_header(payload)
    assert lilambd.decode_payment_header(enc) == payload
    urlsafe = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    assert lilambd.decode_payment_header(urlsafe) == payload
