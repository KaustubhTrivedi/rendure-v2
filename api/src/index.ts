import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import jobs from './routes/jobs.js'
import profile from './routes/profile.js'

export const app = new Hono()

app.get('/', (c) => {
  return c.text('Rendure API')
})

app.route('/profile', profile)
app.route('/jobs', jobs)

if (process.env.NODE_ENV !== 'test') {
  serve({
    fetch: app.fetch,
    port: 3002
  }, (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  })
}
