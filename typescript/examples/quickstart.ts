// Free previews: no wallet needed. Run: npx tsx examples/quickstart.ts
import { Lilambd } from "lilambd";

const client = new Lilambd();

// Discovery endpoints are always free.
console.log(await client.health());

// Any paid route returns a free 3-row preview with `sample: true`.
const airports = await client.airports.search({ q: "tokyo" }, { sample: true });
console.log(airports);

// Path placeholders are filled from params.
const hnd = await client.airports.getByCode({ code: "HND" }, { sample: true });
console.log(hnd);

// Generic form, for routes added after this SDK was generated.
const units = await client.get("units", "/convert", { value: 1, from: "mi", to: "km" }, { sample: true });
console.log(units);
