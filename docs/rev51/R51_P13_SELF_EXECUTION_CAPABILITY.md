# Runtime Rev5.1 P13 — Self-Execution Capability Check

P13 evaluates required operations against automated execution planes before any human handoff. Runtime internal execution, connected provider APIs, workspace MCP, approved remote runners, and trusted-host agents are considered before manual transport. AUTO_EXECUTABLE and AUTOMATION_PATH_REQUIRED deny manual handoff. HARD_BOUNDARY is required before an explicit break-glass manual path can be considered.
