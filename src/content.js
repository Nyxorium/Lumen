/**
 * Lumen - content.js
 * Surfaces the AT Protocol `pronouns` field on bsky.app profile pages.
 */

const INJECTED_ATTR = "data-lumen-pronouns";

/**
 * Extract a DID or handle from the current bsky.app URL.
 * Profile URLs are either:
 *   /profile/<handle>
 *   /profile/did:plc:...
 */
function getActorFromURL() {
  const match = window.location.pathname.match(/^\/profile\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Fetch the profile record from the public AT Protocol API.
 * No auth needed - getProfile is public.
 */
async function fetchPronouns(actor) {
  try {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.associated?.pronouns ?? data?.pronouns ?? null;
  } catch {
    return null;
  }
}

/**
 * Find the handle element on the profile page.
 * bsky.app renders the handle as a <div> containing text starting with "@"
 * inside the profile header.
 */
function findHandleElement() {
  // The handle sits in the profile header as a span/div with text "@handle"
  // We look for an element whose text content matches @handle pattern
  const candidates = document.querySelectorAll(
    '[data-testid="profileHeaderHandle"]'
  );
  if (candidates.length > 0) return candidates[0];

  // Fallback: scan for elements with @ text in the profile header area
  const all = document.querySelectorAll("div, span");
  for (const el of all) {
    if (
      el.childNodes.length === 1 &&
      el.childNodes[0].nodeType === Node.TEXT_NODE &&
      el.textContent.startsWith("@") &&
      el.closest('[data-testid="profileView"]')
    ) {
      return el;
    }
  }
  return null;
}

/**
 * Inject the pronouns inside the handle element, matching Nyxo Sky's style:
 *   @handle · They/Them
 * The span is appended inside the handle element so it fully inherits
 * font size, color, and line-height — no overrides needed.
 */
function injectPronouns(handleEl, pronouns) {
  // Avoid double-injecting
  if (handleEl.querySelector(`[${INJECTED_ATTR}]`)) return;

  const badge = document.createElement("span");
  badge.setAttribute(INJECTED_ATTR, "true");
  // U+00B7 is the middle dot · — same separator bsky.app uses between handle and other metadata
  badge.textContent = ` · ${pronouns}`;

  handleEl.appendChild(badge);
}

/**
 * Remove any existing injected badge (for navigation cleanup).
 */
function cleanup() {
  document
    .querySelectorAll(`[${INJECTED_ATTR}]`)
    .forEach((el) => el.remove());
}

/**
 * Main run function - checks current URL, fetches + injects pronouns.
 */
async function run() {
  const actor = getActorFromURL();
  if (!actor) return;

  const pronouns = await fetchPronouns(actor);
  if (!pronouns) return;

  // The profile DOM may not be ready yet, so poll briefly
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    const handleEl = findHandleElement();
    if (handleEl) {
      clearInterval(interval);
      injectPronouns(handleEl, pronouns);
    }
    if (attempts > 20) clearInterval(interval); // give up after ~2s
  }, 100);
}

/**
 * bsky.app is a SPA - we need to re-run on navigation.
 * We watch for URL changes via a MutationObserver on the document title,
 * which reliably changes on each navigation.
 */
let lastURL = location.href;

const observer = new MutationObserver(() => {
  if (location.href !== lastURL) {
    lastURL = location.href;
    cleanup();
    run();
  }
});

observer.observe(document.querySelector("title") ?? document.documentElement, {
  subtree: true,
  childList: true,
  characterData: true,
});

// Run on initial load too
run();