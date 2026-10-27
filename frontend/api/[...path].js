// Same-origin JSON proxy keeps the browser refresh cookie first-party.
// File bytes go directly to the authenticated API, avoiding function body limits.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const origin = process.env.BACKEND_URL;
  if (!origin || !origin.startsWith("https://")) return res.status(503).json({detail:"API is not configured"});
  const path = new URL(req.url, "https://local.invalid");
  if (!path.pathname.startsWith("/api/") || !["GET","POST","DELETE","OPTIONS"].includes(req.method))
    return res.status(404).end();
  if (path.pathname.endsWith("/attachments") && req.method === "POST")
    return res.status(400).json({detail:"Upload directly to the API"});
  const headers = {};
  for (const name of ["authorization","cookie","origin","content-type","x-kuku-platform"])
    if (typeof req.headers[name] === "string") headers[name] = req.headers[name];
  try {
    const upstream = await fetch(new URL(path.pathname + path.search, origin), {
      method:req.method, headers, redirect:"error", signal:AbortSignal.timeout(20000),
      ...(req.method === "POST" ? {body:JSON.stringify(req.body ?? {})} : {}),
    });
    res.statusCode = upstream.status;
    for (const name of ["content-type","retry-after","x-content-type-options"])
      if (upstream.headers.has(name)) res.setHeader(name,upstream.headers.get(name));
    const cookies = upstream.headers.getSetCookie();
    if (cookies.length) res.setHeader("Set-Cookie",cookies);
    res.end(await upstream.text());
  } catch {
    res.status(502).json({detail:"KUKU is temporarily unavailable. Please try again."});
  }
};
