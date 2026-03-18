import './globals.css'

export const metadata = {
  title: 'Intelligence | Private Banking',
  description: 'AI-powered banking intelligence dashboard.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
