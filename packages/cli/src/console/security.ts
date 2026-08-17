// ---------------------------------------------------------------------------
// The console's only security boundary.
//
// The product decision is "loopback only, no auth": anything that can reach
// 127.0.0.1 can already read and write ~/.fabric directly, so a password stops
// nobody real and costs every user a prompt. That decision is about
// AUTHENTICATION — it does not mean "accept any request that arrives".
//
// A page on the open internet can make your browser POST to
// http://127.0.0.1:7777, and a hostile DNS name can resolve to 127.0.0.1 so the
// request looks local (DNS rebinding). Neither is the user acting; both would be
// executing someone else's intent with the user's file permissions. This module
// is what separates "a request from the console page" from "a request at the
// console page".
//
// Pure function on purpose: it is cheap to cover every forged-header shape here,
// and every future write endpoint inherits that coverage instead of re-proving
// it. Callers must run it BEFORE dispatching to a handler.
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export type OriginVerdict = { ok: true } | { ok: false; reason: string };

function hostnameOf(hostHeader: string): string {
  // `Host` is `hostname[:port]`; IPv6 literals are bracketed (`[::1]:7777`).
  const trimmed = hostHeader.trim();
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    return close === -1 ? trimmed : trimmed.slice(0, close + 1);
  }
  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

/**
 * Decide whether a mutating request came from the console page running on this
 * machine.
 *
 * @param headers   `origin` / `host` exactly as received (missing = undefined).
 * @param boundPort the port the server actually bound (not the requested one —
 *                  the port can fall back when 7777 is busy, and pinning the
 *                  wrong number would reject every real request).
 */
export function isSameOriginLoopback(
  headers: { origin?: string | undefined; host?: string | undefined },
  boundPort: number,
): OriginVerdict {
  const host = headers.host;
  if (host === undefined || host.length === 0) {
    return { ok: false, reason: "missing Host header" };
  }
  if (!LOOPBACK_HOSTNAMES.has(hostnameOf(host))) {
    // Rebinding guard: the browser sends the NAME it dialled, so a hostile
    // domain pointed at 127.0.0.1 arrives with that domain in Host even though
    // the packet is local. Checking the socket address would not catch this.
    return { ok: false, reason: `non-loopback Host: ${host}` };
  }

  const origin = headers.origin;
  if (origin === undefined || origin.length === 0) {
    // Browsers attach Origin to every non-GET request, including same-origin
    // ones. Absent means it is not a page-initiated fetch, so there is no user
    // gesture behind it. Rejecting is the conservative read.
    return { ok: false, reason: "missing Origin header" };
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return { ok: false, reason: `unparseable Origin: ${origin}` };
  }
  if (parsed.protocol !== "http:") {
    return { ok: false, reason: `non-http Origin: ${origin}` };
  }
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname) && !LOOPBACK_HOSTNAMES.has(`[${parsed.hostname}]`)) {
    return { ok: false, reason: `cross-site Origin: ${origin}` };
  }
  if (parsed.port !== String(boundPort)) {
    // Another loopback service is still someone else. Without this, any local
    // program that can get a page loaded on any port could drive the console.
    return { ok: false, reason: `Origin port ${parsed.port} != bound ${String(boundPort)}` };
  }
  return { ok: true };
}
