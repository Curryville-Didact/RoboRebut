export type RawInput = {
  message: string;
  planType?: string | null;
};

export type NormalizedInput = {
  text: string;
  metadata: {
    length: number;
    hasQuestion: boolean;
    sentimentHint: "negative" | "neutral" | "positive";
  };
};

export type ObjectionType =
  | "price"
  | "timing"
  | "authority"
  | "trust"
  | "confusion"
  | "competitor"
  | "no_need"
  | "brush_off"
  | "hidden";

export type ClassificationResult = {
  type: ObjectionType;
  confidence: number;
  signals: string[];
};

export type StrategyResult = {
  approach: string;
  tone: string;
  structure: string[];
  tag?: string;
};

export type GeneratedResponse = {
  reply: string;
  followUps: string[];
};

export type EvaluationResult = {
  score: number;
  criteria: {
    relevance: number;
    toneMatch: number;
    strategyAlignment: number;
  };
  needsRetry: boolean;
};

export type InteractionLog = {
  input: string;
  classification: ClassificationResult;
  strategy: StrategyResult;
  output: string;
  score: number;
  timestamp: number;
};