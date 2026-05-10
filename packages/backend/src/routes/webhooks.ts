import { FastifyInstance } from 'fastify'

export async function webhookRoutes(app: FastifyInstance) {
  app.post('/api/webhooks/new-lead', async (request, reply) => {
    const secret = request.headers['x-webhook-secret']

    if (secret !== process.env.WEBHOOK_SECRET) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }

    const payload = request.body as any
    const record = payload.record

    console.log('New lead received:', {
      id: record.id,
      full_name: record.full_name,
      company: record.company,
      work_email: record.work_email,
      phone_number: record.phone_number,
      team_type: record.team_type,
      team_size: record.team_size,
      utm_source: record.utm_source,
      utm_medium: record.utm_medium,
      utm_campaign: record.utm_campaign,
      created_at: record.created_at
    })

    if (process.env.GTM_AGENT_WEBHOOK_URL) {
      try {
        await fetch(process.env.GTM_AGENT_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: 'new_lead',
            source: 'getrebut.ai',
            lead: {
              id: record.id,
              full_name: record.full_name,
              company: record.company,
              work_email: record.work_email,
              phone_number: record.phone_number,
              team_type: record.team_type,
              team_size: record.team_size,
              message: record.message,
              sms_consent: record.sms_consent,
              utm_source: record.utm_source,
              utm_medium: record.utm_medium,
              utm_campaign: record.utm_campaign,
              created_at: record.created_at
            }
          })
        })
        console.log('GTM agent notified successfully')
      } catch (err) {
        console.error('GTM agent notification failed:', err)
      }
    }

    return reply.status(200).send({ received: true })
  })
}
