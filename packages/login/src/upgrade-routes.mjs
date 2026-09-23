/** Compatible with DSH's upgrade table lookup, with authenticated prefix routes. */
export class PrefixUpgradeRoutes extends Map {
  get(pathname) {
    const exact = super.get(pathname);
    if (exact) return exact;
    if (typeof pathname !== 'string') return undefined;
    let match;
    for (const route of this.values()) {
      if (route.kind !== 'prefix') continue;
      const boundary = route.path.endsWith('/') ? route.path : `${route.path}/`;
      if (pathname.startsWith(boundary) && (!match || route.path.length > match.path.length)) match = route;
    }
    return match;
  }

}
