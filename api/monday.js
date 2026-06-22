// Vercel Serverless Function: proxies GraphQL requests to api.monday.com.
// The browser can't call monday.com's API directly (it doesn't allow
// cross-origin requests), so this same-origin function relays the request.
//
// The monday.com personal API token lives only in this function's
// environment variable (MONDAY_API_TOKEN), set in the Vercel project's
// Settings -> Environment Variables. It is never sent to or stored in
// the browser. If that env var isn't set, it falls back to whatever
// Authorization header the browser sent, so local/manual testing still works.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ errors: [{ message: "Method not allowed" }] });
    return;
  }

  try {
    const auth = process.env.MONDAY_API_TOKEN || req.headers["authorization"] || "";
    const mondayRes = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
        "API-Version": "2024-10",
      },
      body: JSON.stringify(req.body),
    });

    const data = await mondayRes.json();
    res.status(mondayRes.status).json(data);
  } catch (err) {
    res.status(502).json({ errors: [{ message: err.message }] });
  }
}
