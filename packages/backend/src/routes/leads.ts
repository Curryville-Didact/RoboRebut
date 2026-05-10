import { FastifyInstance } from 'fastify'
import { supabase } from '../lib/supabase.js'

export async function leadsRoutes(app: FastifyInstance) {
  app.post('/api/leads', async (request, reply) => {
    const {
      full_name,
      company,
      work_email,
      phone_number,
      team_type,
      team_size,
      message,
      sms_consent,
      utm_source,
      utm_medium,
      utm_campaign
    } = request.body as any

    if (!full_name || !work_email || !phone_number) {
      return reply.status(400).send({ error: 'Missing required fields' })
    }

    const { data, error } = await supabase
      .from('leads')
      .insert([{
        full_name,
        company,
        work_email,
        phone_number,
        team_type,
        team_size,
        message,
        sms_consent: sms_consent === true,
        utm_source,
        utm_medium,
        utm_campaign,
        source: 'landing_page'
      }])
      .select()
      .single()

    if (error) {
      console.error('Lead insert error:', error)
      return reply.status(500).send({ error: 'Failed to save lead' })
    }

    // TODO: trigger GTM agent webhook here
    // await fetch(process.env.GTM_AGENT_WEBHOOK_URL, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(data)
    // })

    return reply.status(201).send({ success: true, lead_id: data.id })
  })
}
