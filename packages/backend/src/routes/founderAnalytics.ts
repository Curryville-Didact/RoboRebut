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
}
