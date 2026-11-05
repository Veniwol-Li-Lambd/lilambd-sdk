import base64
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

REQUIREMENTS = {
    "x402Version": 2,
    "error": "payment required",
    "resource": {"url": "http://fake/airports/HND", "description": "Get an airport"},
    "accepts": [
        {
            "scheme": "exact",
            "network": "eip155:8453",
            "amount": "5000",
            "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            "payTo": "0x000000000000000000000000000000000000dEaD",
            "maxTimeoutSeconds": 60,
        }
    ],
}
FREE_PATHS = {"/koyomi/helplines", "/security/stats", "/health", "/"}


class FakeAPI:
    def __init__(self):
        self.requests = []


def make_handler(state):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # silence
            pass

        def _json(self, status, payload, headers=None):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            parsed = urlparse(self.path)
            query = {k: v[0] for k, v in parse_qs(parsed.query).items()}
            headers = {k.lower(): v for k, v in self.headers.items()}
            state.requests.append({"path": parsed.path, "query": query, "headers": headers, "raw": self.path})
            path = parsed.path
            if path == "/llms.txt":
                body = b"# Lilambd\n"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path.startswith("/missing"):
                return self._json(404, {"error": "not found"})
            if path.startswith("/bad"):
                return self._json(400, {"error": "bad param"})
            if path.startswith("/boom"):
                return self._json(500, {"error": "server"})
            if "x-rapidapi-key" in headers:
                return self._json(200, {"mode": "rapidapi", "path": path, "query": query})
            if path in FREE_PATHS:
                return self._json(200, {"free": True, "path": path, "query": query})
            if query.get("sample") == "1":
                return self._json(200, {"sample": True, "rows": [1, 2, 3], "path": path})
            sig = headers.get("payment-signature") or headers.get("x-payment")
            if sig:
                if sig == "reject":
                    return self._json(402, {"error": "invalid payment"}, {"PAYMENT-REQUIRED": _b64(REQUIREMENTS)})
                receipt = _b64({"success": True, "transaction": "0xabc", "network": "eip155:8453"})
                return self._json(200, {"paid": True, "path": path, "query": query}, {"PAYMENT-RESPONSE": receipt})
            return self._json(402, {"error": "payment required", "x402Version": 2},
                              {"PAYMENT-REQUIRED": _b64(REQUIREMENTS)})

    return Handler


def _b64(obj):
    return base64.b64encode(json.dumps(obj).encode()).decode()


@pytest.fixture()
def server():
    state = FakeAPI()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(state))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    state.url = f"http://127.0.0.1:{httpd.server_address[1]}"
    try:
        yield state
    finally:
        httpd.shutdown()
        httpd.server_close()
