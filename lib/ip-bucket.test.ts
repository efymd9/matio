import { describe, expect, it } from "vitest";
import { ipBucket, IPV6_BUCKET_BITS } from "./ip-bucket";

// The bucket every per-IP limiter counts per (#351). What matters: addresses a
// client can swap among at will land in ONE bucket, addresses it cannot do not
// — and anything we cannot parse is left exactly as it came, so the shared
// "unknown" fail-closed bucket and every IPv4 hash survive unchanged.

describe("ipBucket — IPv6 counts per /64", () => {
  it("two addresses of one /64 share a bucket", () => {
    expect(ipBucket("2001:db8::1")).toBe(ipBucket("2001:db8::ffff"));
    expect(ipBucket("2001:db8:abcd:12:1::1")).toBe(
      ipBucket("2001:0db8:abcd:0012:ffff:ffff:ffff:fffe"),
    );
  });

  it("a neighbouring /64 is another bucket", () => {
    expect(ipBucket("2001:db8:0:1::1")).not.toBe(ipBucket("2001:db8::1"));
    expect(ipBucket("2001:db8:abcd:13::1")).not.toBe(ipBucket("2001:db8:abcd:12::1"));
  });

  it("the bucket names the network and never the host", () => {
    expect(ipBucket("2001:db8:abcd:12:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:abcd:12::/64");
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
  });

  it("a compressed prefix expands before it is cut", () => {
    expect(ipBucket("2001:db8::7")).toBe(ipBucket("2001:db8:0:0:5::"));
    expect(ipBucket("2001:db8:1::7")).toBe("2001:db8:1:0::/64");
    expect(ipBucket("1::")).toBe("1:0:0:0::/64");
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("1:2:3:4:5:6:7::")).toBe("1:2:3:4::/64");
  });

  it("the unspecified address :: is a bucket of its own, not a crash", () => {
    expect(ipBucket("::")).toBe("0:0:0:0::/64");
  });

  it("case and leading zeros do not split a bucket", () => {
    expect(ipBucket("2001:DB8:ABCD:0012::1")).toBe(ipBucket("2001:db8:abcd:12::2"));
  });

  it("a zone id is dropped", () => {
    expect(ipBucket("fe80::1%en0")).toBe(ipBucket("fe80::1"));
    expect(ipBucket("fe80::1%en0")).toBe(ipBucket("fe80::2%en1"));
    expect(ipBucket("fe80::1%en0")).toBe("fe80:0:0:0::/64");
    expect(ipBucket("fe80::1%en0")).not.toContain("%");
  });

  it("an embedded IPv4 tail counts as the last two groups", () => {
    // NAT64: the prefix is what is cut, the dotted tail is host bits.
    expect(ipBucket("64:ff9b::192.0.2.1")).toBe("64:ff9b:0:0::/64");
    expect(ipBucket("64:ff9b::192.0.2.1")).toBe(ipBucket("64:ff9b::198.51.100.9"));
    // A dotted tail on a full address still lands in the right place.
    expect(ipBucket("1:2:3:4:5:6:1.2.3.4")).toBe("1:2:3:4::/64");
  });

  it("IPV6_BUCKET_BITS is the /64 the spec fixed", () => {
    expect(IPV6_BUCKET_BITS).toBe(64);
  });
});

describe("ipBucket — IPv4 and IPv4-mapped stay per address", () => {
  it("::ffff:a.b.c.d and a.b.c.d are one bucket, and it is the IPv4 itself", () => {
    expect(ipBucket("::ffff:192.0.2.1")).toBe(ipBucket("192.0.2.1"));
    expect(ipBucket("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(ipBucket("::FFFF:192.0.2.1")).toBe("192.0.2.1");
  });

  it("the hex spelling of a mapped address is the same IPv4", () => {
    expect(ipBucket("::ffff:c000:201")).toBe("192.0.2.1");
    expect(ipBucket("0:0:0:0:0:ffff:c000:0201")).toBe("192.0.2.1");
    expect(ipBucket("::ffff:c000:201%en0")).toBe("192.0.2.1");
  });

  it("plain IPv4 passes through byte for byte — its hash must not move", () => {
    for (const ip of ["203.0.113.7", "0.0.0.0", "255.255.255.255", "10.0.0.1"]) {
      expect(ipBucket(ip)).toBe(ip);
    }
  });

  it("two IPv4 addresses of one /24 are NOT merged", () => {
    expect(ipBucket("203.0.113.7")).not.toBe(ipBucket("203.0.113.8"));
    expect(ipBucket("::ffff:203.0.113.7")).not.toBe(ipBucket("::ffff:203.0.113.8"));
  });

  it("a ::ffff: lookalike that is not the mapped prefix is an ordinary IPv6", () => {
    // 1::ffff:… and 0:0:0:1:0:ffff:… differ in the first five groups.
    expect(ipBucket("1::ffff:192.0.2.1")).toBe("1:0:0:0::/64");
    expect(ipBucket("0:0:0:1:0:ffff:c000:201")).toBe("0:0:0:1::/64");
  });
});

describe("ipBucket — what we cannot parse passes through untouched", () => {
  it('"unknown" stays "unknown" — the shared fail-closed bucket survives', () => {
    expect(ipBucket("unknown")).toBe("unknown");
  });

  it("garbage is not bucketed as if it were a network", () => {
    for (const junk of [
      "",
      " ",
      "not-an-ip",
      "1:2:3",
      "2001:db8::1::2",
      ":::",
      ":1:2:3:4:5:6:7",
      "1:2:3:4:5:6:7:8:9",
      "12345::1",
      "g::1",
      "::ffff:999.1.1.1",
      "::ffff:1.2.3",
      "1.2.3.4::1",
      "[2001:db8::1]",
      "2001:db8::/32",
      "1:2:3:4:5:6:7::8",
    ]) {
      expect(ipBucket(junk), JSON.stringify(junk)).toBe(junk);
    }
  });

  it("garbage with a colon does not collapse into one shared bucket", () => {
    // Two different junk strings keep two different buckets: the helper never
    // maps unparseable input onto a common value.
    expect(ipBucket("junk:a")).not.toBe(ipBucket("junk:b"));
  });
});

describe("ipBucket — the one constant narrows it later", () => {
  it("a /56 masks the fourth group and merges the /64s inside it", () => {
    expect(ipBucket("2001:db8:abcd:1201::1", 56)).toBe("2001:db8:abcd:1200::/56");
    expect(ipBucket("2001:db8:abcd:12ff::1", 56)).toBe(ipBucket("2001:db8:abcd:1200::9", 56));
    expect(ipBucket("2001:db8:abcd:1300::1", 56)).not.toBe(ipBucket("2001:db8:abcd:1200::1", 56));
  });

  it("a /48 drops the whole fourth group", () => {
    expect(ipBucket("2001:db8:abcd:12::1", 48)).toBe("2001:db8:abcd::/48");
    expect(ipBucket("2001:db8:abcd:ffff::1", 48)).toBe("2001:db8:abcd::/48");
  });
});
