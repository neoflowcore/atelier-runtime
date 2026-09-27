# Runtime Rev5.1 P12 — Fallback Bootstrap Receipt

P12 records why a provider was rejected, which ready adapter was selected, the exact candidate/source transport, remote validation run count, generated source artifacts, promotion state, and cleanup state. The exact-candidate remote full-run count is capped at one. Receipt generation performs no dispatch, provider mutation, paid compute, credential binding, or source promotion.
