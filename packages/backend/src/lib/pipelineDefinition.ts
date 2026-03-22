import type { ObjectionType } from "../types/pipeline.js";

export const CANONICAL_PIPELINE = [
  "INPUT",
  "CLASSIFY",
  "STRATEGIZE",
  "GENERATE",
  "EVALUATE",
  "STORE",
] as const;

export const OBJECTION_TYPES: ObjectionType[] = [
  "price",
  "timing",
  "authority",
  "trust",
  "confusion",
  "brush_off",
  "hidden",
];

export const PRODUCT_RULES = {
  identity:
    "RoboRebut is a real-time objection handling engine, not a generic chatbot.",
  coreGoal:
    "Transform unstructured resistance into a controlled, strategic reply.",
  requiredFlow:
    "INPUT → CLASSIFY → STRATEGIZE → GENERATE → EVALUATE → STORE",
};