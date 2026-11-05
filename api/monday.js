// Vercel Serverless Function: proxies GraphQL requests to api.monday.com.
// The browser can't call monday.com's API directly (it doesn't allow
// cross-origin requests), so this same-origin function relays the request.
//
// The monday.com personal API token lives only in this function's
// environment variable (MONDAY_API_TOKEN), set in the Vercel project's
// Settings -> Environment Variables. It is never sent to or stored in
// the browser. If that env var isn't set, it falls back to whatever
// Authorization header the browser sent, so local/manual testing still works.
//
// Every request is checked against lib/proxyGuard.js first: only the
// read-only queries the dashboard itself makes, against the Disciplinary
// Action Tracker board, are relayed. This keeps private boards (e.g. the
// Manager Disciplinary Action Tracker) out of reach of the dashboard link.

const { checkRequest } = require("../lib/proxyGuard");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ errors: [{ message: "Method not allowed" }] });
    return;
  }

  try {
    const auth = process.env.MONDAY_API_TOKEN || req.headers["authorization"] || "";
    const callMonday = async (query, variables) => {
      const r = await fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
          "API-Version": "2024-10",
        },
        body: JSON.stringify({ query, variables }),
      });
      return { status: r.status, json: await r.json() };
    };

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
    const denied = await checkRequest(body, async (q, v) => (await callMonday(q, v)).json);
    if (denied) {
      res.status(403).json({ errors: [{ message: denied }] });
      return;
    }

    const { status, json } = await callMonday(body.query, body.variables);
    res.status(status).json(json);
  } catch (err) {
    res.status(502).json({ errors: [{ message: err.message }] });
  }
}
