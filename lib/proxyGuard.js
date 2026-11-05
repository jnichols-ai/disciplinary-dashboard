/* Allowlist for the monday.com proxy (api/monday.js and server.js).

   The proxy attaches a server-side token that can see far more than this
   dashboard needs (including PRIVATE boards such as the Manager Disciplinary
   Action Tracker). Without this guard, anyone with the dashboard link could
   send any GraphQL query through it -- e.g. change the Board ID in Settings
   to a private board, list every board in the account, or run mutations.

   Only the three read-only queries app.js actually makes are allowed:
     1. First page of items on the Disciplinary Action Tracker board
     2. Next page of items by cursor (cursors only come from query 1)
     3. Public URL for a PDF attachment -- only if that asset is attached to
        an item on the Disciplinary Action Tracker board
   Everything else is rejected with 403. */

const ALLOWED_BOARD_ID = "18418855689";
const PDF_COLUMN_ID = "file_mm4j9vyx";

const norm = (q) => String(q || "").replace(/\s+/g, " ").trim();

const FIRST_PAGE_RE =
  /^query \(\$boardId: \[ID!\]\) \{ boards\(ids: \$boardId\) \{ items_page\(limit: 100\) \{ cursor items \{ id name url column_values\(ids: \[[^\]{}()$]*\]\) \{ id text value \} \} \} \} \}$/;
const NEXT_PAGE_RE =
  /^query \(\$cursor: String!\) \{ next_items_page\(limit: 100, cursor: \$cursor\) \{ cursor items \{ id name url column_values\(ids: \[[^\]{}()$]*\]\) \{ id text value \} \} \} \}$/;
const ASSET_QUERY = "query ($ids: [ID!]!) { assets(ids: $ids) { public_url } }";

const onlyKeys = (obj, keys) =>
  obj && typeof obj === "object" &&
  Object.keys(obj).sort().join(",") === keys.slice().sort().join(",");

// Cache of asset IDs attached to the allowed board (refreshed every 5 min).
let assetCache = { ids: null, at: 0 };

async function allowedAssetIds(callMonday) {
  if (assetCache.ids && Date.now() - assetCache.at < 5 * 60 * 1000) return assetCache.ids;
  const ids = new Set();
  let data = await callMonday(
    `query { boards(ids: [${ALLOWED_BOARD_ID}]) { items_page(limit: 500) { cursor items { column_values(ids: ["${PDF_COLUMN_ID}"]) { value } } } } }`
  );
  let page = data?.data?.boards?.[0]?.items_page;
  const collect = (p) => {
    for (const item of p?.items || []) {
      for (const cv of item.column_values || []) {
        try {
          const v = JSON.parse(cv.value || "null");
          for (const f of v?.files || []) if (f.assetId != null) ids.add(String(f.assetId));
        } catch (e) { /* ignore */ }
      }
    }
  };
  collect(page);
  while (page?.cursor) {
    data = await callMonday(
      `query ($c: String!) { next_items_page(limit: 500, cursor: $c) { cursor items { column_values(ids: ["${PDF_COLUMN_ID}"]) { value } } } }`,
      { c: page.cursor }
    );
    page = data?.data?.next_items_page;
    collect(page);
  }
  assetCache = { ids, at: Date.now() };
  return ids;
}

/* Returns null if the request is allowed, or an error message string.
   callMonday(query, variables) -> parsed JSON response from monday. */
async function checkRequest(body, callMonday) {
  if (!body || typeof body.query !== "string") return "Bad request.";
  const q = norm(body.query);
  const v = body.variables || {};

  if (FIRST_PAGE_RE.test(q)) {
    if (onlyKeys(v, ["boardId"]) && Array.isArray(v.boardId) &&
        v.boardId.length === 1 && String(v.boardId[0]) === ALLOWED_BOARD_ID) return null;
    return "This dashboard is limited to the Disciplinary Action Tracker board.";
  }

  if (NEXT_PAGE_RE.test(q)) {
    if (onlyKeys(v, ["cursor"]) && typeof v.cursor === "string" && v.cursor.length < 2000) return null;
    return "Bad request.";
  }

  if (q === ASSET_QUERY) {
    if (!onlyKeys(v, ["ids"]) || !Array.isArray(v.ids) || v.ids.length !== 1) return "Bad request.";
    const id = String(v.ids[0]);
    if (!/^\d+$/.test(id)) return "Bad request.";
    let allowed = await allowedAssetIds(callMonday);
    if (!allowed.has(id)) {
      assetCache = { ids: null, at: 0 }; // maybe a brand-new upload; refresh once
      allowed = await allowedAssetIds(callMonday);
    }
    return allowed.has(id) ? null : "That file isn't part of the Disciplinary Action Tracker board.";
  }

  return "Query not allowed through this proxy.";
}

module.exports = { checkRequest, ALLOWED_BOARD_ID };
