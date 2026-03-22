// src/services/rebuttalGenerator.ts

export interface GenerateInput {
    objection: string;
    classification: {
      category: string;
      confidence: number;
    };
    strategy: {
      strategy: string;
      rationale: string;
    };
  }
  
  export async function generateRebuttal(
    input: GenerateInput
  ): Promise<string> {
    const { objection, strategy } = input;
  
    const templates: Record<string, (_o: string) => string> = {
      "value reframing": (_o) =>
        `I hear you — and that’s a fair concern. When you look at the long-term value this creates, it usually ends up being more efficient and less costly than staying where things are now.`,
  
      "credibility anchoring": (_o) =>
        `Totally fair to want proof. Most people in your position felt the same way until they saw how this actually plays out — the key difference is how consistently it performs once implemented.`,
  
      "urgency alignment": (_o) =>
        `That makes sense. The only thing I’d highlight is that waiting usually keeps the same problem in place — and in many cases, it ends up costing more time or effort later.`,
  
      "needs alignment": (_o) =>
        `That’s a good point. The way this typically works is by aligning directly with what you’re trying to accomplish, not adding complexity.`,
  
      "general reassurance": (_o) =>
        `I hear you. Let’s break it down simply so you can see exactly how this fits and whether it makes sense for you.`,
    };
  
    const handler =
      templates[strategy.strategy] || templates["general reassurance"];
  
    return handler(objection);
  }