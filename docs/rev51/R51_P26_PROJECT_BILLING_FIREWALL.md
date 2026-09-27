# Runtime Rev5.1 P26 — Project / Account Billing Firewall

P26 layers project daily/monthly budgets, provider-account budget, concurrent paid-lease/resource/storage/snapshot/volume/egress caps over the existing P2 job-level durable admission/settlement/billing controls. `GLOBAL_PAID_COMPUTE=DENY` blocks new paid leases/resources while allowing cleanup, control-plane preservation, and required evidence preservation. It does not create resources or bind credentials.
