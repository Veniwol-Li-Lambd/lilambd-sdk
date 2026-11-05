"""Core HTTP client (stdlib only)."""
from __future__ import annotations

import base64
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable, Dict, Mapping, Optional, Tuple

from ._errors import BadRequest, LilambdError, NotFound, PaymentRequired
from ._version import __version__

DEFAULT_BASE_URL = "https://api.lilambd.com"
PAYMENT_HEADER = "PAYMENT-SIGNATURE"
LEGACY_PAYMENT_HEADER = "X-PAYMENT"
CHALLENGE_HEADER = "PAYMENT-REQUIRED"

PaymentSigner = Callable[[Dict[str, Any]], str]

_PLACEHOLDER = re.compile(r"\{([A-Za-z0-9_]+)\}")


def decode_payment_header(value: str) -> Dict[str, Any]:
    """Decode a base64 (std or url-safe, padding optional) JSON header."""
    raw = value.strip()
    pad = "=" * (-len(raw) % 4)
    for decoder in (base64.b64decode, base64.urlsafe_b64decode):
        try:
            data = json.loads(decoder(raw + pad).decode("utf-8"))
            if isinstance(data, dict):
                return data
        except Exception:  # noqa: BLE001
            continue
    raise ValueError("could not decode payment header")


def encode_payment_header(payload: Mapping[str, Any]) -> str:
    """Base64-encode a JSON payment payload for ``PAYMENT-SIGNATURE``."""
    return base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode()


def _normalize_param_name(name: str) -> str:
    # Allow Python-keyword-safe aliases such as ``from_`` -> ``from``.
    if name.endswith("_") and not name.endswith("__"):
        return name[:-1]
    return name


def _format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, tuple)):
        return ",".join(_format_value(v) for v in value)
    return str(value)


class Response:
    """A successful API response."""

    def __init__(self, status: int, headers: Dict[str, str], body: bytes, url: str) -> None:
        self.status = status
        self.headers = headers
        self.content = body
        self.url = url

    @property
    def text(self) -> str:
        return self.content.decode("utf-8", errors="replace")

    def json(self) -> Any:
        return json.loads(self.content.decode("utf-8")) if self.content else None

    @property
    def payment_response(self) -> Optional[Dict[str, Any]]:
        """Decoded ``PAYMENT-RESPONSE`` settlement receipt, if present."""
        for key in ("payment-response", "x-payment-response"):
            if key in self.headers:
                try:
                    return decode_payment_header(self.headers[key])
                except ValueError:
                    return None
        return None


class Client:
    """Client for the Lilambd data API.

    Args:
        base_url: API root. Defaults to ``https://api.lilambd.com``.
        payment_signer: ``callable(requirements: dict) -> str`` returning a
            ready-to-send ``PAYMENT-SIGNATURE`` header value (base64 x402
            payment payload). When set, a 402 is answered once automatically.
        rapidapi_key / rapidapi_host: use RapidAPI instead of x402. Pass the
            RapidAPI gateway as ``base_url``.
        timeout: socket timeout in seconds.
        headers: extra headers sent on every request.
        payment_header: header used for the signed payload
            (``PAYMENT-SIGNATURE`` or legacy ``X-PAYMENT``).
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        payment_signer: Optional[PaymentSigner] = None,
        rapidapi_key: Optional[str] = None,
        rapidapi_host: Optional[str] = None,
        timeout: float = 30,
        headers: Optional[Mapping[str, str]] = None,
        payment_header: str = PAYMENT_HEADER,
    ) -> None:
        if base_url is None:
            base_url = f"https://{rapidapi_host}" if rapidapi_host else DEFAULT_BASE_URL
        self.base_url = base_url.rstrip("/")
        self.payment_signer = payment_signer
        self.rapidapi_key = rapidapi_key
        self.rapidapi_host = rapidapi_host
        self.timeout = timeout
        self.payment_header = payment_header
        self.headers: Dict[str, str] = {
            "Accept": "application/json",
            "User-Agent": f"lilambd-python/{__version__}",
        }
        if headers:
            self.headers.update(headers)
        if rapidapi_key:
            self.headers["x-rapidapi-key"] = rapidapi_key
        if rapidapi_host:
            self.headers["x-rapidapi-host"] = rapidapi_host
        from ._generated import attach_namespaces

        attach_namespaces(self)

    def __repr__(self) -> str:
        mode = "rapidapi" if self.rapidapi_key else "x402"
        return f"<lilambd.Client {self.base_url} mode={mode}>"

    # ------------------------------------------------------------------ urls
    def build_url(self, product: str, route: str = "/", **params: Any) -> str:
        """Build ``{base}/{product}{route}?query`` substituting ``{placeholders}``."""
        query: Dict[str, Any] = {}
        for key, value in params.items():
            query[_normalize_param_name(key)] = value

        def sub(match: "re.Match[str]") -> str:
            name = match.group(1)
            if name not in query or query[name] is None:
                raise BadRequest(f"missing path parameter '{name}' for {route}")
            return urllib.parse.quote(_format_value(query.pop(name)), safe="")

        path = _PLACEHOLDER.sub(sub, route or "")
        if path and not path.startswith("/"):
            path = "/" + path
        product = product.strip("/")
        url = self.base_url + (f"/{product}" if product else "") + path
        if not product and not path:
            url += "/"
        pairs = [(k, _format_value(v)) for k, v in query.items() if v is not None]
        if pairs:
            url += "?" + urllib.parse.urlencode(pairs)
        return url

    # ------------------------------------------------------------- transport
    def _send(self, url: str, headers: Dict[str, str]) -> Tuple[int, Dict[str, str], bytes]:
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:  # noqa: S310
                return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read()
        except urllib.error.HTTPError as err:
            body = err.read() if err.fp else b""
            return err.code, {k.lower(): v for k, v in (err.headers or {}).items()}, body
        except urllib.error.URLError as err:
            raise LilambdError(f"network error: {err.reason}", url=url) from err

    @staticmethod
    def _parse_body(body: bytes) -> Any:
        if not body:
            return None
        try:
            return json.loads(body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return body.decode("utf-8", errors="replace")

    def _payment_required(self, headers: Dict[str, str], body: bytes, url: str) -> PaymentRequired:
        parsed = self._parse_body(body)
        requirements: Dict[str, Any] = {}
        header = headers.get(CHALLENGE_HEADER.lower())
        if header:
            try:
                requirements = decode_payment_header(header)
            except ValueError:
                requirements = {}
        if not requirements and isinstance(parsed, dict):
            requirements = parsed
        msg = "payment required"
        if isinstance(parsed, dict) and isinstance(parsed.get("error"), str):
            msg = parsed["error"]
        elif requirements.get("error"):
            msg = str(requirements["error"])
        return PaymentRequired(msg, requirements=requirements, body=parsed, url=url)

    def _raise_for(self, status: int, headers: Dict[str, str], body: bytes, url: str) -> None:
        parsed = self._parse_body(body)
        msg = f"HTTP {status}"
        if isinstance(parsed, dict):
            detail = parsed.get("error") or parsed.get("message") or parsed.get("detail")
            if detail:
                msg = f"HTTP {status}: {detail}"
        if status in (400, 422):
            raise BadRequest(msg, status=status, body=parsed, url=url)
        if status == 404:
            raise NotFound(msg, status=status, body=parsed, url=url)
        raise LilambdError(msg, status=status, body=parsed, url=url)

    def request(self, product: str, route: str = "/", **params: Any) -> Response:
        """GET a route and return the raw :class:`Response`."""
        url = self.build_url(product, route, **params)
        status, headers, body = self._send(url, dict(self.headers))
        if status == 402:
            challenge = self._payment_required(headers, body, url)
            if self.payment_signer is None or self.rapidapi_key:
                raise challenge
            signature = self.payment_signer(challenge.requirements)
            if not signature:
                raise challenge
            retry_headers = dict(self.headers)
            retry_headers[self.payment_header] = signature
            status, headers, body = self._send(url, retry_headers)
            if status == 402:
                raise self._payment_required(headers, body, url)
        if status >= 400:
            self._raise_for(status, headers, body, url)
        return Response(status, headers, body, url)

    def get(self, product: str, route: str = "/", **params: Any) -> Any:
        """GET ``{base}/{product}{route}`` and return decoded JSON."""
        resp = self.request(product, route, **params)
        ct = resp.headers.get("content-type", "")
        if "json" in ct or not ct:
            try:
                return resp.json()
            except ValueError:
                return resp.text
        return resp.text

    def sample(self, product: str, route: str = "/", **params: Any) -> Any:
        """Free 3-row preview of any paid route (adds ``sample=1``)."""
        params["sample"] = 1
        return self.get(product, route, **params)

    # ------------------------------------------------------------ discovery
    def _root(self, path: str) -> Response:
        url = self.base_url + path
        status, headers, body = self._send(url, dict(self.headers))
        if status >= 400:
            self._raise_for(status, headers, body, url)
        return Response(status, headers, body, url)

    def index(self) -> Any:
        """``GET /`` service index."""
        return self._root("/").json()

    def openapi(self) -> Any:
        """``GET /openapi.json``."""
        return self._root("/openapi.json").json()

    def llms_txt(self) -> str:
        """``GET /llms.txt``."""
        return self._root("/llms.txt").text

    def x402_manifest(self) -> Any:
        """``GET /.well-known/x402``."""
        return self._root("/.well-known/x402").json()

    def health(self) -> Any:
        """``GET /health``."""
        return self._root("/health").json()

    def meta(self) -> Any:
        """``GET /meta``."""
        return self._root("/meta").json()


class Namespace:
    """Base class for generated per-product namespaces."""

    product: str = ""

    def __init__(self, client: Client) -> None:
        self._client = client

    def _call(self, route: str, params: Dict[str, Any], sample: bool) -> Any:
        clean = {k: v for k, v in params.items() if v is not None}
        if sample:
            clean["sample"] = 1
        return self._client.get(self.product, route, **clean)

    def __repr__(self) -> str:
        return f"<lilambd namespace {self.product}>"
