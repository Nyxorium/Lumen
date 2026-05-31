/**
 * Lumen - popup.js
 * Handles authentication, pronoun fetching, and saving via the AT Protocol.
 */

const browser = window.browser || window.chrome;
const MAX_GRAPHEMES = 20;

const $ = (id) => document.getElementById(id);

const viewLogin = $("view-login");
const viewMain = $("view-main");

// ── Grapheme counting ──────────────────────────────────────────────────────
// Use Intl.Segmenter if available (counts actual grapheme clusters),
// otherwise fall back to string length.
function countGraphemes(str) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return [...new Intl.Segmenter().segment(str)].length;
  }
  return str.length;
}

// ── Storage helpers ────────────────────────────────────────────────────────
async function getSession() {
  const result = await browser.storage.local.get(["handle", "did", "accessJwt", "pds"]);
  if (!result.handle) return null;
  return result;
}

async function saveSession(session) {
  await browser.storage.local.set(session);
}

async function clearSession() {
  await browser.storage.local.remove(["handle", "did", "accessJwt", "pds"]);
}

// ── AT Protocol helpers ────────────────────────────────────────────────────

/**
 * Resolve a handle to its PDS endpoint.
 * We use the identity resolveHandle to get the DID, then plc.directory to
 * get the PDS endpoint from the DID document.
 */
async function resolvePDS(handle) {
  const res = await fetch(
    `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
  );
  if (!res.ok) throw new Error("Could not resolve handle.");
  const { did } = await res.json();

  // Fetch DID document to find the PDS
  const docRes = await fetch(`https://plc.directory/${did}`);
  if (!docRes.ok) throw new Error("Could not fetch DID document.");
  const doc = await docRes.json();

  const pdsService = doc.service?.find(
    (s) => s.type === "AtprotoPersonalDataServer"
  );
  if (!pdsService) throw new Error("No PDS found in DID document.");

  return { did, pds: pdsService.serviceEndpoint };
}

/**
 * Create a session (login) against the user's PDS.
 */
async function createSession(handle, appPassword) {
  const { did, pds } = await resolvePDS(handle);

  const res = await fetch(`${pds}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password: appPassword }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Invalid handle or app password.");
  }

  const data = await res.json();
  return { handle, did, accessJwt: data.accessJwt, pds };
}

/**
 * Fetch the current profile record directly from the user's PDS.
 * We need the full record (not just the view) to safely putRecord without
 * wiping unrelated fields like displayName, description, avatar, etc.
 */
async function fetchProfileRecord(session) {
  const res = await fetch(
    `${session.pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(session.did)}&collection=app.bsky.actor.profile&rkey=self`,
    {
      headers: { Authorization: `Bearer ${session.accessJwt}` },
    }
  );
  if (!res.ok) throw new Error("Could not fetch profile record.");
  return res.json(); // { uri, cid, value: { ... } }
}

/**
 * Write the updated profile record back to the PDS.
 * We merge the new pronouns value into the existing record to avoid clobbering
 * other profile fields.
 */
async function putProfileRecord(session, existingRecord, pronouns) {
  const updatedValue = { ...existingRecord.value };

  if (pronouns.trim() === "") {
    delete updatedValue.pronouns;
  } else {
    updatedValue.pronouns = pronouns.trim();
  }

  const res = await fetch(`${session.pds}/xrpc/com.atproto.repo.putRecord`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.actor.profile",
      rkey: "self",
      swapRecord: existingRecord.cid,
      record: updatedValue,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Failed to save pronouns.");
  }
}

// ── UI helpers ─────────────────────────────────────────────────────────────

function showLogin() {
  viewLogin.style.display = "flex";
  viewMain.style.display = "none";
}

function showMain(handle, pronouns = "") {
  viewLogin.style.display = "none";
  viewMain.style.display = "flex";
  $("display-handle").textContent = handle.startsWith("@") ? handle : `@${handle}`;
  $("input-pronouns").value = pronouns;
  updateCharCount(pronouns);
}

function setLoginStatus(msg, type = "") {
  const el = $("login-status");
  el.textContent = msg;
  el.className = `status ${type}`;
}

function setSaveStatus(msg, type = "") {
  const el = $("save-status");
  el.textContent = msg;
  el.className = `status ${type}`;
}

function updateCharCount(value) {
  const count = countGraphemes(value);
  const el = $("char-count");
  el.textContent = `${count}/${MAX_GRAPHEMES}`;
  el.className = "char-count" + (count > MAX_GRAPHEMES ? " over" : count >= 16 ? " warn" : "");
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  const session = await getSession();
  if (!session) {
    showLogin();
    return;
  }

  // Fetch current pronouns to pre-fill the input
  try {
    const record = await fetchProfileRecord(session);
    showMain(session.handle, record.value?.pronouns ?? "");
  } catch {
    // Session may have expired — fall back to login
    await clearSession();
    showLogin();
  }
}

// ── Event listeners ────────────────────────────────────────────────────────

$("input-pronouns").addEventListener("input", (e) => {
  updateCharCount(e.target.value);
  setSaveStatus("");
});

$("btn-login").addEventListener("click", async () => {
  const handle = $("input-handle").value.trim();
  const password = $("input-password").value.trim();

  if (!handle || !password) {
    setLoginStatus("Please fill in both fields.", "error");
    return;
  }

  $("btn-login").disabled = true;
  setLoginStatus("Signing in…");

  try {
    const session = await createSession(handle, password);
    await saveSession(session);
    const record = await fetchProfileRecord(session);
    showMain(session.handle, record.value?.pronouns ?? "");
  } catch (err) {
    setLoginStatus(err.message, "error");
  } finally {
    $("btn-login").disabled = false;
  }
});

$("btn-save").addEventListener("click", async () => {
  const pronouns = $("input-pronouns").value;
  const graphemes = countGraphemes(pronouns);

  if (graphemes > MAX_GRAPHEMES) {
    setSaveStatus(`Too long — max ${MAX_GRAPHEMES} characters.`, "error");
    return;
  }

  const session = await getSession();
  if (!session) { showLogin(); return; }

  $("btn-save").disabled = true;
  setSaveStatus("Saving…");

  try {
    const record = await fetchProfileRecord(session);
    await putProfileRecord(session, record, pronouns);
    setSaveStatus("Saved!", "success");
  } catch (err) {
    setSaveStatus(err.message, "error");
  } finally {
    $("btn-save").disabled = false;
  }
});

$("btn-signout").addEventListener("click", async () => {
  await clearSession();
  showLogin();
  setLoginStatus("");
});

init();