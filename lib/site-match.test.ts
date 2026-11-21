import { describe, expect, it } from "vitest";
import { isSameSite } from "./site-match";

describe("isSameSite", () => {
  it("matches identical hostnames", () => {
    expect(isSameSite("en.wikipedia.org", "en.wikipedia.org")).toBe(true);
  });

  it("matches different subdomains of the same registrable domain (Wikipedia language subdomains)", () => {
    expect(isSameSite("www.wikipedia.org", "en.wikipedia.org")).toBe(true);
    expect(isSameSite("en.wikipedia.org", "ja.wikipedia.org")).toBe(true);
  });

  it("does not match a genuinely different apex domain, even one that looks related", () => {
    expect(isSameSite("en.wikipedia.org", "commons.wikimedia.org")).toBe(false);
  });

  it("does not match an unrelated site", () => {
    expect(isSameSite("en.wikipedia.org", "evil.example.com")).toBe(false);
  });

  it("handles multi-part public suffixes correctly (co.uk), unlike a naive last-two-labels split", () => {
    expect(isSameSite("shop.client.co.uk", "blog.client.co.uk")).toBe(true);
    expect(isSameSite("client.co.uk", "other.co.uk")).toBe(false);
  });

  it("falls back to exact match for hosts with no registrable domain (IP/localhost dev)", () => {
    expect(isSameSite("localhost", "localhost")).toBe(true);
    expect(isSameSite("127.0.0.1", "127.0.0.1")).toBe(true);
    expect(isSameSite("127.0.0.1", "localhost")).toBe(false);
  });
});
