import "server-only";
import Mux from "@mux/mux-node";

declare global {
  var __muxClient: Mux | undefined;
}

// Lazy + cached. The Mux SDK reads MUX_TOKEN_ID / MUX_TOKEN_SECRET from env
// by default; we only assert they exist when actually issuing a request.
export function getMux(): Mux {
  if (globalThis.__muxClient) return globalThis.__muxClient;

  if (!process.env.MUX_TOKEN_ID || !process.env.MUX_TOKEN_SECRET) {
    throw new Error("MUX_TOKEN_ID and MUX_TOKEN_SECRET must be set");
  }

  const client = new Mux({
    tokenId: process.env.MUX_TOKEN_ID,
    tokenSecret: process.env.MUX_TOKEN_SECRET,
  });
  globalThis.__muxClient = client;
  return client;
}
