/** `url_clicks.ip_address` is VARCHAR(64); IPv6 with a zone fits comfortably. */
export const MAX_IP_LENGTH = 64;

/**
 * Reduces a client IP to the precision configured for click analytics.
 *
 * `full`       - store as received (the default; matches the original brief).
 * `anonymized` - drop the last IPv4 octet / the last 80 bits of an IPv6
 *                address, which keeps geo-level analytics while removing the
 *                identifier for a single household or device.
 * `none`       - store nothing identifying.
 */
export const anonymizeIp = (ipAddress, mode = "full") => {
  const value = typeof ipAddress === "string" && ipAddress !== "" ? ipAddress : "unknown";

  if (mode === "none") {
    return "redacted";
  }

  if (mode !== "anonymized" || value === "unknown") {
    return value.slice(0, MAX_IP_LENGTH);
  }

  if (value.includes(":")) {
    const groups = value.split(":");
    return [...groups.slice(0, 3), ":"].join(":").slice(0, MAX_IP_LENGTH);
  }

  const octets = value.split(".");

  if (octets.length === 4) {
    return `${octets[0]}.${octets[1]}.${octets[2]}.0`;
  }

  return value.slice(0, MAX_IP_LENGTH);
};
