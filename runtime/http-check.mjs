export function validateRoutesDocument(document) {
  const errors = [];
  if (!document || document.schema_version !== 1 || !Array.isArray(document.routes)) {
    return { ok: false, errors: ["INVALID_ROUTES_DOCUMENT"] };
  }
  for (const key of Object.keys(document)) {
    if (!["schema_version", "routes"].includes(key)) errors.push(`FORBIDDEN_ROUTES_FIELD:${key}`);
  }
  for (const [index, route] of document.routes.entries()) {
    if (!route || typeof route.path !== "string" || !route.path.startsWith("/") || route.path.startsWith("//")) {
      errors.push(`INVALID_ROUTE_PATH:${index}`);
    }
    if (!Number.isInteger(route?.status) || route.status < 100 || route.status > 599) {
      errors.push(`INVALID_ROUTE_STATUS:${index}`);
    }
    for (const key of Object.keys(route ?? {})) {
      if (!["path", "status"].includes(key)) errors.push(`FORBIDDEN_ROUTE_FIELD:${index}:${key}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
