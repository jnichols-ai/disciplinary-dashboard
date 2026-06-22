// Vercel Serverless Function: proxies GraphQL requests to api.monday.com.
// The browser can't call monday.com's API directly (it doesn't allow
// cross-origin requests), so this same-origin function relays the request.
// It never stores the API token -- it only forwards the Authorization
// header the browser sent on this one request.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ errors: [{ message: "Method not allowed" }] });
    return;
  }

  try {
    const mondayRes = await fetch("https://api.monday.com/v2", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers["authorization"] || "",
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
