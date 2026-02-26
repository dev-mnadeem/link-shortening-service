import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.middleware.js";

/**
 * Route table.
 *
 * `GET /:shortUrl` is a catch-all for one path segment, so anything that must
 * not be mistaken for a short code has to be registered ahead of it.
 */
export const createUrlRouter = ({ urlController, writeLimiter, redirectLimiter }) => {
  const router = Router();

  router.post("/shorten", writeLimiter, asyncHandler(urlController.createShortUrl));
  router.get("/:shortUrl", redirectLimiter, asyncHandler(urlController.redirectShortUrl));

  return router;
};
