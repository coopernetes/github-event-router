import { Router } from "express";
import { getSubscribers, refreshSubscribers } from "./subscriber.js";

export const router = Router();

router.get("/api/v1/readiness", (req, res) => {
  res.json({ ready: "up" });
});

router.get("/api/v1/liveness", (req, res) => {
  res.json({ status: "up" });
});

router.get("/api/v1/subscribers", (req, res) => {
  res.json(JSON.stringify(getSubscribers()));
});

router.post("/api/v1/refresh", (req, res) => {
  try {
    refreshSubscribers();
    res.status(200).send();
  } catch (error) {
    if (Error.isError(error)) {
      console.error(error.message);
    }
    res.status(500).send({
      error: "Failed to refresh subscribers"
    });
  }
})