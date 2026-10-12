/**
 * Simple native cookie parser middleware for Express without third-party dependencies.
 * Parses the `Cookie` header into `req.cookies`.
 */
export function cookieParser(req, res, next) {
  const cookieHeader = req.headers.cookie;
  req.cookies = {};

  if (!cookieHeader) {
    return next();
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    if (key) {
      try {
        req.cookies[key] = decodeURIComponent(val);
      } catch {
        req.cookies[key] = val;
      }
    }
  }

  next();
}
