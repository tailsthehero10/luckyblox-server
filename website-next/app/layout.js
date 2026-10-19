import './globals.css';

export const metadata = {
  title: 'LuckyBlox',
  description: 'A Roblox revival. Play classic experiences on the client of their era.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="lb-header">
          <a className="lb-brand" href="/">
            <span className="lb-brand-mark" aria-hidden="true" />
            <span>LuckyBlox</span>
          </a>
          <nav className="lb-nav">
            <a href="/">Home</a>
            <a href="/games">Games</a>
            <a href="/download">Download</a>
          </nav>
        </header>
        <main className="lb-main">{children}</main>
        <footer className="lb-footer">
          <span>LuckyBlox</span>
          <span>Runs on the client of each game&rsquo;s era.</span>
        </footer>
      </body>
    </html>
  );
}