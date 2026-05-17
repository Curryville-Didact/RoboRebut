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

    const gtmUrl = process.env.GTM_AGENT_WEBHOOK_URL?.trim()
    if (gtmUrl && gtmUrl !== 'placeholder' && gtmUrl.startsWith('http')) {
      try {
        await fetch(gtmUrl, {
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

  // Twilio SMS inbound webhook
  app.post('/api/webhooks/twilio/sms', async (request, reply) => {
    const body = request.body as any
    const from = body.From as string
    const msgBody = (body.Body as string || '').trim().toUpperCase()

    console.log(`Inbound SMS from ${from}: ${msgBody}`)

    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    if (msgBody === 'STOP') {
      await supabase
        .from('leads')
        .update({ sms_opt_out: true, sms_opt_out_at: new Date().toISOString() })
        .eq('phone', from)

      await supabase.from('outreach_log').insert({
        email_type: 'sms_stop',
        to_email: from,
        status: 'opt_out',
        notes: 'Merchant replied STOP',
        sent_at: new Date().toISOString()
      })

      console.log(`Merchant ${from} opted out via STOP`)
    } else if (msgBody === 'HELP') {
      // Twilio auto-handles HELP replies per A2P compliance
      console.log(`Merchant ${from} requested HELP`)
    } else {
      await supabase.from('outreach_log').insert({
        email_type: 'sms_reply',
        to_email: from,
        status: 'received',
        notes: `Merchant replied: ${body.Body}`,
        sent_at: new Date().toISOString()
      })

      console.log(`Merchant reply logged from ${from}`)
    }

    // Twilio expects TwiML response
    reply.header('Content-Type', 'text/xml')
    return reply.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`)
  })
}
