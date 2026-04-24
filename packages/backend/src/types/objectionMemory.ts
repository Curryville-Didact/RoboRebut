export interface ObjectionMemoryRecord {
  id: string;
  conversationId: string;

  rawUserMessage: string;

  normalizedObjectionType: string;
  objectionAssertionFamily: string;

  generatedOpening: string;

  canonicalKey: string;
  signalKey: string;
  variationHash: string;

  usageCount: number;
  lastUsedAt?: string;

  createdAt: string;
}

