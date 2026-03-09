// Educational links mapping check IDs to MDN/relevant documentation URLs
// Pure data — no Node.js deps, safe for client-side import

export const LEARN_MORE_URLS: Record<string, string> = {
  // Security headers
  hsts: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security",
  "x-content-type-options":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Content-Type-Options",
  "x-frame-options":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options",
  "referrer-policy":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy",

  // Cross-origin headers
  coep: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Embedder-Policy",
  coop: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy",
  corp: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Resource-Policy",
  cors: "https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS",

  // CSP
  "csp-present":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP",
  "csp-unsafe-inline":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP#unsafe_inline_script",
  "csp-unsafe-eval":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP#unsafe_eval",

  // Permissions policy
  "permissions-policy":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Permissions-Policy",

  // TLS
  "tls-1.2":
    "https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security",
  "tls-1.3":
    "https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security",
  "tls-1.0-absent":
    "https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security",
  "tls-1.1-absent":
    "https://developer.mozilla.org/en-US/docs/Web/Security/Transport_Layer_Security",

  // SSL
  "ssl-certificate":
    "https://developer.mozilla.org/en-US/docs/Glossary/SSL_certificate",

  // Content
  "mixed-content":
    "https://developer.mozilla.org/en-US/docs/Web/Security/Mixed_content",
  "admin-paths":
    "https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/02-Configuration_and_Deployment_Management_Testing/04-Review_Old_Backup_and_Unreferenced_Files_for_Sensitive_Information",

  // Server
  "server-info":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Server",

  // Email
  spf: "https://www.cloudflare.com/learning/dns/dns-records/dns-spf-record/",
  dmarc: "https://www.cloudflare.com/learning/dns/dns-records/dns-dmarc-record/",
  dkim: "https://www.cloudflare.com/learning/dns/dns-records/dns-dkim-record/",

  // Cookie security
  "cookie-security":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie",

  // Subresource integrity
  sri: "https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity",

  // Open redirect
  "open-redirect":
    "https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html",

  // Cache-Control
  "cache-control":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control",

  // DNSSEC
  dnssec: "https://www.cloudflare.com/dns/dnssec/how-dnssec-works/",

  // security.txt
  "security-txt": "https://securitytxt.org/",

  // Other
  "domain-blacklist":
    "https://www.spamhaus.org/consumer/faq/",
  "redirect-chain":
    "https://developer.mozilla.org/en-US/docs/Web/HTTP/Redirections",
};
