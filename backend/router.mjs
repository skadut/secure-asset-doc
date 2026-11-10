// Path + method matcher. Pure: no I/O.
// Route: { re: RegExp, methods: string[], run, pub?: boolean }. Returns { route, params } | { status: 405, allow } | null.
export function matchRoute(routes, method, pathname) {
  let pathHit = false;
  const allow = new Set();
  for (const route of routes) {
    const m = pathname.match(route.re);
    if (!m) continue;
    pathHit = true;
    if (route.methods.includes(method)) return { route, params: m.slice(1) };
    for (const x of route.methods) allow.add(x);
  }
  return pathHit ? { status: 405, allow: [...allow] } : null;
}
