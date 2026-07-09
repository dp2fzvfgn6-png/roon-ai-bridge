import { Router } from "express";
import { safetyPolicyPayload } from "../../safety/actionSafety";
import { getConfiguredVolumeSafetyLimits } from "../../safety/volumeSafety";
import { ApiContext } from "../server";

export function createSafetyRouter(context: ApiContext): Router {
  const router = Router();

  router.get("/safety/policy", (_req, res) => {
    res.json(
      safetyPolicyPayload(
        context.volumeLimitService?.activeSafetyLimits?.() || getConfiguredVolumeSafetyLimits()
      )
    );
  });

  return router;
}
