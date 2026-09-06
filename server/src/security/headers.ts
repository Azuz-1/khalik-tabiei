import type { RequestHandler } from "express";
import { webSocketOrigin } from "./origin.js";

export function securityHeaders(production: boolean, publicOrigin: string | null): RequestHandler {
  const connectSources = ["'self'"];
  if (publicOrigin) connectSources.push(webSocketOrigin(publicOrigin));
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "form-action 'self'",
  ];
  if (production) csp.push("upgrade-insecure-requests");

  return (_req, res, next) => {
    res.setHeader("Content-Security-Policy", csp.join("; "));
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (production) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}
