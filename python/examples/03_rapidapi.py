"""Use the API through RapidAPI instead of x402 (billing via your RapidAPI plan).

    export RAPIDAPI_KEY=...
    export RAPIDAPI_HOST=<the host shown on the RapidAPI listing>
"""
import os

import lilambd

client = lilambd.Client(
    rapidapi_key=os.environ["RAPIDAPI_KEY"],
    rapidapi_host=os.environ["RAPIDAPI_HOST"],
    base_url=os.environ.get("RAPIDAPI_BASE_URL"),  # defaults to https://<host>
)

print(client.colors.get_by_name_or_hex(name_or_hex="teal"))
print(client.get("languages", "/search", q="japanese", limit=3))
