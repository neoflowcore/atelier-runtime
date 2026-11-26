def surface_fixture(repo, branch, now):
    body = {"enforce_admins": {"enabled": True}, "allow_force_pushes": {"enabled": False}, "allow_deletions": {"enabled": False}}
    main = {**body, "required_pull_request_reviews": {"required_approving_review_count": 1, "bypass_pull_request_allowances": {"users": [], "teams": [], "apps": []}}, "required_status_checks": {"strict": True, "contexts": ["selftest"]}}
    def obs(ref, value):
        return {"repository": repo, "branch": ref, "status": 200, "source": "github.branch_protection", "body": value}
    return {"repository": repo, "branch": branch, "surface_id": "SYNTHETIC_TEST_FIXTURE", "observed_at": now, "main_protection": obs("main", main), "development_protection": obs(branch, body), "required_checks": ["selftest"], "cas_receipt": {"surface_id": "SYNTHETIC_TEST_FIXTURE", "kind": "REMOTE_SANDBOX", "non_force": True, "stale_expected_rejected": True, "fresh_expected_applied": True, "evidence_id": "SYNTHETIC_TEST_ONLY"}}
