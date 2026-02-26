import { Router } from "express";
import { asyncHandler } from "../middleware/asyncHandler.middleware.js";

/**
 * Liveness and readiness probes. Operational surface, not product surface -
 * the container healthcheck and any load balancer need somewhere to poll that
 * is exempt from rate limiting and does not look like a short code.
 */
export const createHealthRouter = ({ repository }) => {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  router.get(
    "/readyz",
    asyncHandler(async (_req, res) => {
      try {
        await repository.ping();
        res.json({ status: "ready", storage: repository.driver });
      } catch {
        res.status(503).json({ status: "unavailable", storage: repository.driver });
      }
    }),
  );

  return router;
};
