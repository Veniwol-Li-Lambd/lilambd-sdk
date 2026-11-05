"""Pay per call with x402 (USDC on Base) using the official ``x402`` package.

    pip install lilambd "x402[evm]" eth-account
    export PRIVATE_KEY=0x...   # a wallet funded with a little USDC on Base

The ``x402`` package API evolves; adapt ``sign()`` to the version you install.
Any callable ``(requirements: dict) -> str`` works as ``payment_signer``.
"""
import os

import lilambd


def make_signer():
    from eth_account import Account
    from x402.clients.base import x402Client  # type: ignore[import-not-found]

    account = Account.from_key(os.environ["PRIVATE_KEY"])
    x402 = x402Client(account)

    def sign(requirements: dict) -> str:
        options = requirements.get("accepts", [])
        chosen = x402.select_payment_requirements(options)
        return x402.create_payment_header(chosen, requirements.get("x402Version", 2))

    return sign


def main() -> None:
    # Without a signer you get a PaymentRequired error describing the price.
    try:
        lilambd.Client().airports.get_by_code(code="HND")
    except lilambd.PaymentRequired as err:
        print(f"{err.resource} costs ${err.price_usd} ({err.amount} atomic USDC) -> {err.pay_to} on {err.network}")

    if "PRIVATE_KEY" not in os.environ:
        print("set PRIVATE_KEY to make a paid call")
        return

    client = lilambd.Client(payment_signer=make_signer())
    print(client.airports.get_by_code(code="HND"))


if __name__ == "__main__":
    main()
