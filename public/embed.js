/*
 * AI Virtual Assistant embed loader.
 *
 * A customer drops one tag on their page:
 *
 *   <script src="https://<host>/embed.js" data-ai-assistant
 *           data-height="720px"></script>
 *
 * and this script injects a responsive <iframe> pointing back at the
 * AI Assistant app in embed mode (`/?embed=1`). The iframe target origin is
 * derived from THIS script's own src, so mic / audio / websocket traffic all
 * stay same-origin *inside* the frame - the only cross-origin boundary is the
 * host page -> iframe embed itself.
 *
 * The app is a full-viewport SPA (h-screen), so the iframe is sized by the
 * host (data-height / data-width), not by content - there is deliberately no
 * postMessage auto-resize channel here; it would be circular for a viewport
 * app.
 *
 * data-* options:
 *   data-key      REQUIRED - the admin-issued embed key. Passed to the app as
 *                 `?key=`; the app validates it server-side and refuses to load
 *                 on a missing/wrong key.
 *   data-height   iframe height   (default "720px")
 *   data-width    iframe width    (default "100%")
 *   data-target   CSS selector of a container to mount into; defaults to
 *                 inserting the iframe right after this <script> tag.
 */
(function () {
  "use strict";

  // `document.currentScript` is null when the tag is loaded async/defer, so
  // fall back to the marker attribute the customer pastes with the tag.
  var self =
    document.currentScript || document.querySelector("script[data-ai-assistant]");
  if (!self) return;

  var origin;
  try {
    origin = new URL(self.src).origin;
  } catch (e) {
    return;
  }

  var opts = self.dataset || {};
  var height = opts.height || "720px";
  var width = opts.width || "100%";
  var key = opts.key || "";

  var iframe = document.createElement("iframe");
  iframe.src =
    origin + "/?embed=1" + (key ? "&key=" + encodeURIComponent(key) : "");
  iframe.title = "AI Virtual Assistant";
  // Without these, getUserMedia (mic STT) and audio playback are blocked
  // inside a cross-origin iframe by Permissions Policy.
  iframe.setAttribute("allow", "microphone; autoplay; clipboard-write");
  iframe.setAttribute("allowfullscreen", "");
  iframe.style.width = width;
  iframe.style.height = height;
  iframe.style.border = "0";
  iframe.style.display = "block";

  var target = opts.target ? document.querySelector(opts.target) : null;
  if (target) {
    target.appendChild(iframe);
  } else if (self.parentNode) {
    self.parentNode.insertBefore(iframe, self.nextSibling);
  }
})();
