import './globals.css'
import { APP_NAME, APP_TAGLINE } from '../lib/app-config'

export const metadata = {
  title: APP_NAME + ' | ' + APP_TAGLINE,
  description: 'AI-powered intelligence dashboard — analyse any dataset with AI-generated insights, decisions, and forecasts.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
