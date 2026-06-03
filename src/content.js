/**
 * Lumen - content.js
 * Surfaces the AT Protocol `pronouns` field on bsky.app profile pages
 * and post thread views.
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
 * Returns true if the current URL is a post thread view.
 *   /profile/<handle>/post/<rkey>
 */
function isThreadURL() {
  return /^\/profile\/[^/]+\/post\/[^/]+/.test(window.location.pathname);
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
 * Cache to avoid redundant API calls for the same actor within a session.
 * null is also cached to avoid re-fetching profiles with no pronouns set.
 */
const pronounsCache = new Map();

async function fetchPronounsCached(actor) {
  if (pronounsCache.has(actor)) return pronounsCache.get(actor);
  const pronouns = await fetchPronouns(actor);
  pronounsCache.set(actor, pronouns);
  return pronouns;
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
 * Find the handle element within a postThreadItem.
 * Strips Unicode bidi control characters before checking for "@" prefix,
 * since bsky.app wraps handle text in U+202A/U+202C markers.
 */
function findHandleInPost(postEl) {
  const divs = postEl.querySelectorAll('div[dir="auto"]');
  for (const div of divs) {
    const text = div.textContent.trim().replace(/[\u202a\u202c\u200f\u200e]/g, "");
    if (text.startsWith("@") && !text.includes(" ")) {
      return div;
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
 * Scan for all postThreadItem elements and inject pronouns into each.
 * Skips any already injected. Safe to call multiple times as new posts load.
 */
async function injectThreadPronouns() {
  const posts = document.querySelectorAll(
    '[data-testid^="postThreadItem-by-"]'
  );
  for (const post of posts) {
    if (post.querySelector(`[${INJECTED_ATTR}]`)) continue;
    const handle = post
      .getAttribute("data-testid")
      .replace("postThreadItem-by-", "");
    const pronouns = await fetchPronounsCached(handle);
    if (!pronouns) continue;
    const handleEl = findHandleInPost(post);
    if (handleEl) injectPronouns(handleEl, pronouns);
  }
}

/**
 * Try to inject profile header pronouns if the element is present.
 * Returns true if the handle element was found (regardless of whether
 * pronouns were set), so we know to stop trying.
 */
async function tryInjectProfile(actor) {
  const handleEl = findHandleElement();
  if (!handleEl) return false;
  const pronouns = await fetchPronounsCached(actor);
  if (pronouns) injectPronouns(handleEl, pronouns);
  return true;
}

/**
 * Remove any existing injected badges, disconnect the DOM observer,
 * and clear the observer reference.
 */
function cleanup() {
  document.querySelectorAll(`[${INJECTED_ATTR}]`).forEach((el) => el.remove());
  if (threadObserver) {
    threadObserver.disconnect();
    threadObserver = null;
  }
}

let threadObserver = null;

/**
 * Main run function - sets up a MutationObserver on <main> that reacts
 * to DOM changes, attempting injection whenever relevant nodes appear.
 */
async function run() {
  const actor = getActorFromURL();
  if (!actor) return;

  // Disconnect any observer left over from a previous navigation
  if (threadObserver) {
    threadObserver.disconnect();
    threadObserver = null;
  }

  let profileInjected = false;

  threadObserver = new MutationObserver(async () => {
    if (isThreadURL()) await injectThreadPronouns();
    if (!profileInjected) profileInjected = await tryInjectProfile(actor);
  });

  threadObserver.observe(document.querySelector("main") ?? document.body, {
    childList: true,
    subtree: true,
  });

  // Also attempt immediately in case the DOM is already ready
  if (isThreadURL()) await injectThreadPronouns();
  if (!profileInjected) profileInjected = await tryInjectProfile(actor);
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