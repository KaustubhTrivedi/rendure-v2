import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import profile from './routes/profile.js'

const app = new Hono()

app.get('/', (c) => {
  return c.text('Rendure API')
})

app.route('/profile', profile)

serve({
  fetch: app.fetch,
  port: 3002
}, (info) => {
  console.log(`Server is running on http://localhost:${info.port}`)
})
