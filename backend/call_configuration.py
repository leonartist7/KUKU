"""Call configuration diagnostics. No provider connection or credential serialization."""
import ipaddress
import re
from urllib.parse import urlsplit


def secure_livekit_url(value):
    """Accept only a secure, root-level DNS endpoint for this beta's media server.

    A custom TLS port is allowed for self-hosted LiveKit. IP literals, localhost,
    encoded authority characters and alternate paths are deliberately unsupported.
    URL validity is configuration evidence, not a TLS or provider connectivity test.
    """
    if not isinstance(value, str) or not value or len(value) > 2048:
        return False
    if any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in value):
        return False
    if any(char in value for char in ("\\", "%", "@", "?", "#")):
        return False
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
        if (parsed.scheme != "wss" or not hostname or parsed.path not in ("", "/")
                or parsed.username is not None or parsed.password is not None
                or parsed.query or parsed.fragment or (port is not None and not 1 <= port <= 65535)):
            return False
        # Accessing .port rejects malformed/out-of-range ports, but an empty
        # explicit port is accepted by urllib and is not an expected endpoint.
        if parsed.netloc.endswith(":"):
            return False
        try:
            ipaddress.ip_address(hostname)
            return False
        except ValueError:
            pass
        labels = hostname.split(".")
        # Match the browser endpoint policy. Numeric/hex final labels can be
        # parsed as alternate IP forms by WHATWG URL; this beta needs a public
        # DNS TLD. Preserve ASCII IDN (punycode) labels without accepting Unicode
        # authority text, and exclude the reserved localhost subdomain suffix.
        final_label = labels[-1].lower()
        public_tld = re.fullmatch(r"[a-z]{2,63}|xn--[a-z0-9](?:[a-z0-9-]{0,57}[a-z0-9])?", final_label)
        return (len(hostname) <= 253 and len(labels) >= 2
                and final_label != "localhost" and public_tld is not None
                and all(re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label)
                        for label in labels))
    except (TypeError, ValueError, UnicodeError):
        return False


def call_configuration_status(*, enabled, url, api_key, api_secret):
    """Return booleans/reason codes only; never return credentials or endpoint text."""
    url_present = isinstance(url, str) and bool(url.strip())
    secure_transport = secure_livekit_url(url)
    credentials_present = all(isinstance(value, str) and bool(value.strip())
                              for value in (api_key, api_secret))
    configured = secure_transport and credentials_present
    reasons = []
    if not enabled:
        reasons.append("calls_disabled")
    if not url_present:
        reasons.append("provider_url_missing")
    elif not secure_transport:
        reasons.append("provider_url_invalid")
    if not credentials_present:
        reasons.append("provider_credentials_missing")
    return {
        "scope": "configuration_only",
        "calls_enabled": bool(enabled),
        "provider_configured": bool(configured),
        "secure_transport": bool(secure_transport),
        "configuration_ready": bool(enabled and configured),
        "reason_codes": reasons,
        "provider_connection_tested": False,
        "end_to_end_encryption": False,
    }
