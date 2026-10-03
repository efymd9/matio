// What every per-IP limiter counts per. PURE and universal (no `server-only`,
// no Node import) — the hashing stays in lib/trial.ts:hashClientIp, which
// feeds the bucket, never the raw address, into the HMAC.
//
// Why not the address itself: an IPv6 client usually holds a whole /64 (often
// a /56 or a /48) and can rotate its source address inside it at will, so a
// limiter keyed per address hands it a fresh bucket on every rotation (#351).
// So:
//   - IPv4, and an IPv4-mapped IPv6 address (`::ffff:a.b.c.d` or its hex form
//     `::ffff:c000:201`) — the dotted IPv4 itself, byte-identical to what the
//     plain IPv4 request would carry, so both spellings of one client share a
//     bucket and every IPv4 hash stays what it was before this helper;
//   - any other IPv6 address — its first IPV6_BUCKET_BITS bits, spelled
//     `<hextets>::/<bits>`; a zone id (`fe80::1%en0`) is dropped first;
//   - anything unparseable — and "unknown", the shared fail-closed bucket for
//     requests with no trusted client IP — passes through untouched.
//
// /64 over /56: a /56 would cut off whole home networks of several
// subscribers at some providers. If abuse ever comes from a /56, narrow it
// here — the one constant.
export const IPV6_BUCKET_BITS = 64;

// Eight 16-bit groups of an IPv6 address, or null when the text is not one.
// Strict on purpose: a lenient parse would bucket garbage as if it were a
// network. `::` stands for one or more zero groups; a dotted IPv4 tail counts
// as the last two groups.
function parseIpv6(text: string): number[] | null {
  let s = text;
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(tail);
    if (!m) return null;
    const o = m.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    s =
      s.slice(0, lastColon + 1) +
      ((o[0] << 8) | o[1]).toString(16) +
      ":" +
      ((o[2] << 8) | o[3]).toString(16);
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const groups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const left = groups(halves[0]);
  const right = halves.length === 2 ? groups(halves[1]) : [];
  if (!left || !right) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const fill = 8 - left.length - right.length;
  if (fill < 1) return null;
  return [...left, ...Array<number>(fill).fill(0), ...right];
}

export function ipBucket(ip: string, bits: number = IPV6_BUCKET_BITS): string {
  if (!ip.includes(":")) return ip;
  const g = parseIpv6(ip.split("%")[0]);
  if (!g) return ip;

  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
  }

  const shown = Math.ceil(bits / 16);
  const prefix = g.slice(0, shown).map((n, i) => {
    const keep = Math.min(16, bits - 16 * i);
    return ((n >> (16 - keep)) << (16 - keep)).toString(16);
  });
  return `${prefix.join(":")}::/${bits}`;
}
