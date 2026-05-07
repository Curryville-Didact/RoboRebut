import { FastifyInstance } from 'fastify';

export async function founderAnalyticsRoutes(app: FastifyInstance) {
  app.get('/founder/analytics', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) return reply.status(401).send({ error: 'Unauthorized' });

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await app.supabase.auth.getUser(token);
    if (authError || !user) return reply.status(401).send({ error: 'Unauthorized' });

    // Rebuttals per broker
    const { data: rebuttalsByBroker } = await app.supabase
      .from('rebuttal_events')
      .select('user_id, user_email')
      .order('user_id');

    // Aggregate rebuttals per broker in JS
    const brokerMap: Record<string, { email: string; rebuttals: number; conversations: Set<string>; ratings: number[]; }> = {};
    for (const row of rebuttalsByBroker ?? []) {
      if (!brokerMap[row.user_id]) {
        brokerMap[row.user_id] = { email: row.user_email ?? row.user_id, rebuttals: 0, conversations: new Set(), ratings: [] };
      }
      brokerMap[row.user_id].rebuttals++;
    }

    // Conversation counts
    const { data: convRows } = await app.supabase
      .from('rebuttal_events')
      .select('user_id, conversation_id');
    for (const row of convRows ?? []) {
      if (brokerMap[row.user_id]) brokerMap[row.user_id].conversations.add(row.conversation_id);
    }

    // Avg ratings
    const { data: ratingRows } = await app.supabase
      .from('rebuttal_events')
      .select('user_id, rating')
      .not('rating', 'is', null);
    for (const row of ratingRows ?? []) {
      if (brokerMap[row.user_id]) brokerMap[row.user_id].ratings.push(row.rating);
    }

    const brokers = Object.entries(brokerMap).map(([userId, b]) => ({
      userId,
      email: b.email,
      rebuttals: b.rebuttals,
      conversations: b.conversations.size,
      avgRating: b.ratings.length ? +(b.ratings.reduce((a, c) => a + c, 0) / b.ratings.length).toFixed(2) : null,
    })).sort((a, b) => b.rebuttals - a.rebuttals);

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
}
