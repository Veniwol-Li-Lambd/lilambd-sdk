// RapidAPI mode: authenticate with your RapidAPI key instead of x402.
import { Lilambd } from "lilambd";

const client = new Lilambd({
  rapidapiKey: process.env.RAPIDAPI_KEY!,
  rapidapiHost: process.env.RAPIDAPI_HOST ?? "lilambd.p.rapidapi.com",
  baseUrl: process.env.RAPIDAPI_BASE_URL, // defaults to https://{rapidapiHost}
});

const result = await client.colors.nearest({ hex: "#3366ff" });
console.log(result);
