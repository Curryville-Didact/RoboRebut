import fs from "fs";
import path from "path";
import type { InteractionLog } from "../types/pipeline.js";

// Resolve path to logs/interactions.json from backend root
const LOG_FILE = path.resolve(process.cwd(), "logs", "interactions.json");

export function logInteraction(interaction: InteractionLog) {
  try {
    let existing: InteractionLog[] = [];

    // Read existing file if it exists
    if (fs.existsSync(LOG_FILE)) {
      const file = fs.readFileSync(LOG_FILE, "utf-8");

      try {
        existing = JSON.parse(file);
      } catch {
        console.warn("⚠️ Failed to parse log file. Resetting...");
        existing = [];
      }
    }

    // Append new interaction
    existing.push(interaction);

    // Write back to file
    fs.writeFileSync(LOG_FILE, JSON.stringify(existing, null, 2));
  } catch (error) {
    console.error("❌ Logging error:", error);
  }
}

export function logIfImportant(interaction: InteractionLog) {
  const isHidden = interaction.classification.type === "hidden";
  const isLowConfidence = interaction.classification.confidence < 0.75;

  if (isHidden || isLowConfidence) {
    console.warn("\n⚠️ IMPORTANT OBJECTION DETECTED");
    console.warn("Input:", interaction.input);
    console.warn("Type:", interaction.classification.type);
    console.warn("Confidence:", interaction.classification.confidence);
    console.warn("Signals:", interaction.classification.signals);
    console.warn(
      "Timestamp:",
      new Date(interaction.timestamp).toISOString()
    );
    console.warn("--------------------------------------------------\n");
  }
}