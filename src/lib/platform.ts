export type Os = "mac" | "windows" | "linux";

/** Webview user agents: WebKit on macOS, WebView2 on Windows, WebKitGTK on Linux. */
export const OS: Os = (() => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Mac/i.test(ua)) return "mac";
  if (/Windows/i.test(ua)) return "windows";
  return "linux";
})();
