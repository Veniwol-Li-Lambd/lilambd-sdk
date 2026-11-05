"""Explore the API for free: discovery endpoints, free routes and sample=1 previews."""
import lilambd

client = lilambd.Client()

print(client.health())
print(client.koyomi.helplines())                         # free route, no payment
print(client.airports.search(q="tokyo", sample=True))    # free 3-row preview
print(client.sample("units", "/convert", from_="mi", to="km", value=26.2))
