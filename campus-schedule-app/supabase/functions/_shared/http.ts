// Network safety for the Edge Functions.
//  • Calendar links come from users, so fetching them must never reach the
//    server's own network: https only, standard port, no private or
//    link-local addresses (checked for every redirect hop), a size cap and
//    a timeout.
//  • The scheduler proves itself with a shared secret, compared in constant time.
// The pure checks are unit-tested in Node (tests/functions.test.ts).

export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s);
}

export const isIpLiteral = (host: string) => /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");

export function isPrivateAddress(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/** Hostnames that are never allowed, whatever they resolve to. */
export function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "metadata.google.internal";
}

export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * The admin (service role) key Supabase gives Edge Functions. Projects on the
 * new API keys provide SUPABASE_SECRET_KEYS (JSON: name → "sb_secret_…");
 * older projects provide the legacy SUPABASE_SERVICE_ROLE_KEY JWT.
 */
export function serviceKey(read: (name: string) => string | undefined): string {
  try {
    const keys = JSON.parse(read("SUPABASE_SECRET_KEYS") || "{}") as Record<string, string>;
    const key = keys.default ?? Object.values(keys).find((k) => typeof k === "string" && k.startsWith("sb_secret_"));
    if (key) return key;
  } catch {
    // Not set or not JSON: fall back to the legacy key.
  }
  return read("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

type DenoDns ={ resolveDns(host: string, type: "A" | "AAAA"): Promise<string[]> };

async function assertPublicHost(host: string) {
  if (isBlockedHostname(host)) throw new Error("That link points to a private address.");
  if (isIpLiteral(host)) {
    if (isPrivateAddress(host)) throw new Error("That link points to a private address.");
    return;
  }
  const deno = (globalThis as unknown as { Deno?: DenoDns }).Deno;
  if (!deno) return;
  const addresses = [
    ...(await deno.resolveDns(host, "A").catch(() => [] as string[])),
    ...(await deno.resolveDns(host, "AAAA").catch(() => [] as string[])),
  ];
  if (!addresses.length) throw new Error("That link's website couldn't be found.");
  if (addresses.some(isPrivateAddress)) throw new Error("That link points to a private address.");
}

/** Fetch a user-supplied https URL as text, safely. */
export async function safeFetchText(raw: string, opts: { maxBytes?: number; timeoutMs?: number; maxRedirects?: number } = {}): Promise<string> {
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  let url = new URL(raw.trim().replace(/^webcal:\/\//i, "https://"));

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (url.protocol !== "https:") throw new Error("Only https:// calendar links are allowed.");
    if (url.port && url.port !== "443") throw new Error("Calendar links must use the standard https port.");
    if (url.username || url.password) throw new Error("Calendar links can't contain a username or password.");
    await assertPublicHost(url.hostname);

    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "text/calendar, text/plain;q=0.8, */*;q=0.1", "user-agent": "CampusSchedule-CalendarSync/1.0" },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new Error("The calendar link redirected nowhere.");
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`The calendar link answered with HTTP ${res.status}.`);
    }
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("The calendar is too large (over 2 MB).");
      }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      all.set(c, offset);
      offset += c.byteLength;
    }
    return new TextDecoder().decode(all);
  }
  throw new Error("The calendar link redirected too many times.");
}
