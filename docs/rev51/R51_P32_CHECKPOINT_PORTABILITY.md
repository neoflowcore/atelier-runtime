# Runtime Rev5.1 P32 — Cross-Provider Checkpoint Portability

P32 binds a portable checkpoint to exact source/input, completed durable boundary, artifact digests, and state payload. A cross-provider resume creates a new attempt, lease, and fence while reusing the same checkpoint/source/input identity. It is durable-boundary resume, not process migration, and checkpoint digest tampering is fail-closed.
