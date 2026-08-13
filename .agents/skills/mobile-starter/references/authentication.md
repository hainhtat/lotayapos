# Authentication Reference

Server verification is authoritative. The client may decode a token for non-authoritative display hints only after treating it as untrusted. The server must validate the signature with an allow-listed algorithm and claims such as `iss`, `aud`, `exp`, `nbf`, subject, and token type.

Prefer a short-lived in-memory access token and platform secure storage for any refresh credential that must be read by the app. Never embed signing keys. Normalize API failures, use generic login errors to reduce account enumeration, handle 401 with one coordinated refresh and one replay, treat 403 as forbidden, and clear user state, sensitive forms, and protected query data on invalidation/logout.
