"""Python client for the Lilambd data API (x402 pay-per-call or RapidAPI)."""
from ._client import (
    CHALLENGE_HEADER,
    DEFAULT_BASE_URL,
    LEGACY_PAYMENT_HEADER,
    PAYMENT_HEADER,
    Client,
    Namespace,
    Response,
    decode_payment_header,
    encode_payment_header,
)
from ._errors import BadRequest, LilambdError, NotFound, PaymentRequired
from ._generated import PRODUCTS
from ._version import __version__

__all__ = [
    "Client",
    "Namespace",
    "Response",
    "LilambdError",
    "BadRequest",
    "NotFound",
    "PaymentRequired",
    "PRODUCTS",
    "DEFAULT_BASE_URL",
    "PAYMENT_HEADER",
    "LEGACY_PAYMENT_HEADER",
    "CHALLENGE_HEADER",
    "decode_payment_header",
    "encode_payment_header",
    "__version__",
]
