# Runtime Rev5.1 P20 — Evidence Packaging Contract

P20 separates evidence generation from durable collection. Expected paths and digests form a packaging manifest; hidden paths require explicit inclusion. Seal-relevant readback compares observed count and exact digests and blocks empty/mismatched packaging instead of treating an uploader success signal as evidence success.
