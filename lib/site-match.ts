import { getDomain } from "tldts";

/**
 * True when two hostnames belong to the same site, allowing for subdomains
 * (e.g. `en.wikipedia.org` and `www.wikipedia.org` both resolve to the
 * registrable domain `wikipedia.org`). Uses the public suffix list via
 * `tldts` rather than a naive "last two labels" split, which would wrongly
 * treat `shop.client.co.uk` and `blog.client.co.uk` as different sites (or
 * worse, `client.co.uk` and `client.com.au` as the same one).
 *
 * Falls back to exact string equality when either hostname has no
 * registrable domain under the public suffix list (IP addresses, bare
 * `localhost`, custom internal TLDs) - this preserves current behavior for
 * local dev/loopback testing instead of always returning false.
 */
export function isSameSite(hostnameA: string, hostnameB: string): boolean {
  const domainA = getDomain(hostnameA);
  const domainB = getDomain(hostnameB);
  if (domainA === null || domainB === null) {
    return hostnameA === hostnameB;
  }
  return domainA === domainB;
}
