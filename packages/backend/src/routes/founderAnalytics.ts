import { FastifyInstance } from 'fastify';

export async function founderAnalyticsRoutes(app: FastifyInstance) {
  app.get('/founder/analytics', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return reply.status(401).send({ error: 'Unauthorized' });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await app.supabase.auth.getUser(token);
    if (authError || !user) return reply.status(401).send({ error: 'Unauthorized' });

    // Broker stats via RPC (joins auth.users for email)
    const { data: brokerRows, error: brokerError } = await app.supabase
      .rpc('get_broker_analytics');

    if (brokerError) {
      app.log.error(brokerError, 'get_broker_analytics RPC failed');
      return reply.status(500).send({ error: 'Failed to load broker analytics' });
    }

    const brokers = (brokerRows ?? []).map((row: {
      user_id: string;
      email: string;
      rebuttals: number;
      conversations: number;
    }) => ({
      userId: row.user_id,
      email: row.email,
      rebuttals: Number(row.rebuttals),
      conversations: Number(row.conversations),
      avgRating: null,
    }));

    // Top objections across all brokers
    const { data: objectionRows } = await app.supabase
      .from('rebuttal_events')
      .select('objection_type')
      .not('objection_type', 'is', null);

    const objectionMap: Record<string, number> = {};
    for (const row of objectionRows ?? []) {
      objectionMap[row.objection_type] = (objectionMap[row.objection_type] ?? 0) + 1;
    }
    const topObjections = Object.entries(objectionMap)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return reply.send({ brokers, topObjections });
  });

  app.get(
    '/founder/analytics/pattern-intelligence',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const q = (request.query ?? {}) as { limit?: unknown; conversationId?: unknown };
      const limitRaw = typeof q.limit === 'string' ? Number(q.limit) : typeof q.limit === 'number' ? q.limit : null;
      const limit =
        typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(Math.floor(limitRaw), 2500)
          : 250;
      const conversationId =
        typeof q.conversationId === 'string' && q.conversationId.trim().length > 0
          ? q.conversationId.trim()
          : null;

      type RebuttalEventRow = {
        id: string;
        conversation_id: string | null;
        objection_type: string | null;
        confidence_score: number | null;
        was_saved: boolean | null;
        decision_variant: string | null;
        created_at: string;
      };

      try {
        let query = app.supabase
          .from('rebuttal_events')
          .select(
            'id, conversation_id, objection_type, confidence_score, was_saved, decision_variant, created_at'
          )
          .order('created_at', { ascending: false })
          .limit(limit);

        if (conversationId) {
          query = query.eq('conversation_id', conversationId);
        }

        const { data: rows, error } = await query;
        if (error) {
          app.log.error(error, 'founder pattern-intelligence query failed');
          return reply.status(500).send({ error: 'Failed to load pattern intelligence' });
        }

        const intelRows = (Array.isArray(rows) ? (rows as RebuttalEventRow[]) : []) ?? [];

        // Phrase patterns (best-effort; never throw if table missing)
        let phrases: Array<{
          phrase: string;
          deal_type: string | null;
          vertical: string | null;
          occurrences: number;
          conversation_count: number;
        }> = [];
        try {
          const { data: phraseRows, error: phraseError } = await app.supabase
            .from('phrase_patterns')
            .select('phrase, deal_type, vertical, occurrences, conversation_count')
            .order('occurrences', { ascending: false })
            .limit(100);
          if (!phraseError && Array.isArray(phraseRows)) {
            phrases = phraseRows as typeof phrases;
          }
        } catch {
          phrases = [];
        }

        const byVariant: Record<string, number> = {};
        const byObjectionType: Record<string, number> = {};

        let singleVariantCount = 0;
        let savedCount = 0;
        let nullConfidenceCount = 0;
        let confidenceSum = 0;
        let confidenceCount = 0;

        for (const r of intelRows) {
          const variant = r.decision_variant?.trim() ? String(r.decision_variant) : null;
          const objectionType = r.objection_type?.trim() ? String(r.objection_type) : null;

          if (variant) byVariant[variant] = (byVariant[variant] ?? 0) + 1;
          if (objectionType) byObjectionType[objectionType] = (byObjectionType[objectionType] ?? 0) + 1;

          if (variant === 'single') singleVariantCount += 1;
          if (r.was_saved === true) savedCount += 1;

          if (r.confidence_score == null) {
            nullConfidenceCount += 1;
          } else if (typeof r.confidence_score === 'number' && Number.isFinite(r.confidence_score)) {
            confidenceSum += r.confidence_score;
            confidenceCount += 1;
          }
        }

        const topPatternKeys: Array<{ patternKey: string; count: number }> = [];
        const topStrategyTags: Array<{ strategyTag: string; count: number }> = [];

        const branches = Object.entries(byObjectionType)
          .map(([objectionType, total]) => ({
            objectionType,
            total,
            avgUniquePatternKeyCount: null,
            singleCandidateRate: null,
            avgScoreGap: null,
            saveRate: null,
          }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5);

        const total = intelRows.length;
        const singleCandidateRate = total > 0 ? singleVariantCount / total : null;
        const saveRate = total > 0 ? savedCount / total : null;
        const missingPatternKeyRate = 0;
        const avgConfidence = confidenceCount > 0 ? confidenceSum / confidenceCount : null;

        const summary = {
          window: {
            limit,
            conversationId,
            intelRows: total,
          },
          selection: {
            topPatternKeys,
            topStrategyTags,
            singleCandidateRate,
          },
          antiRepeat: {
            appliedRate: null,
            byReason: {},
          },
          dvl: {
            appliedRate: null,
            variantUsage: byVariant,
          },
          confidence: { avg: avgConfidence },
          saves: {
            saveRate,
            savedCount,
          },
          health: {
            missingDecisionMetaRate: 0,
            missingPatternKeyRate,
            fallbackMessageCount: null,
            unknownObjectionTypeCount: 0,
            nullConfidenceCount,
          },
          branches,
        };

        return reply.send({ ...summary, phrases });
      } catch (err) {
        app.log.error(err, 'pattern-intelligence route failed');
        return reply.status(500).send({ error: 'Failed to load pattern intelligence' });
      }
    }
  );
}
