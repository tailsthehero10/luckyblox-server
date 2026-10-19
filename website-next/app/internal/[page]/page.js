import { notFound } from 'next/navigation';

/**
 * The reference site's `/internal/*` pages: blog, jobs, parents, privacy, tos.
 *
 * They share one layout, so one dynamic route renders all five instead of five
 * near-identical files. An unknown slug is a real 404 rather than a blank page.
 */
const PAGES = {
  blog: {
    title: 'Blog',
    body: 'Announcements and development updates are published here as the revival progresses.',
  },
  jobs: {
    title: 'Jobs',
    body: 'LuckyBlox is a community project. There are no paid positions open right now. If you contribute moderation, tooling or client work, ask on the Discord.',
  },
  parents: {
    title: 'For Parents',
    body: 'LuckyBlox is a local-first revival of Roblox. Accounts, saved games and settings are stored on the server you connect to. It is not operated by Roblox Corporation.',
  },
  privacy: {
    title: 'Privacy Policy',
    body: 'We store the account data you provide (username, password hash, avatar and saved game progress) so your account and saves persist. Passwords are stored as salted PBKDF2 hashes, never in plain text. No analytics or ad networks are used.',
  },
  tos: {
    title: 'Terms of Service',
    body: 'Use LuckyBlox for personal, non-commercial play. Do not attempt to disrupt the service, take over other accounts, or upload content you do not have the right to share. LuckyBlox is not affiliated with or endorsed by Roblox Corporation.',
  },
};

export function generateStaticParams() {
  return Object.keys(PAGES).map((page) => ({ page }));
}

export async function generateMetadata({ params }) {
  const { page } = await params;
  const entry = PAGES[page];
  return { title: entry ? `${entry.title} - LuckyBlox` : 'Not found - LuckyBlox' };
}

export default async function InternalPage({ params }) {
  const { page } = await params;
  const entry = PAGES[page];
  if (!entry) notFound();

  return (
    <>
      <h1 className="lb-title">{entry.title}</h1>
      <div className="lb-panel">
        <p className="lb-muted">{entry.body}</p>
      </div>
    </>
  );
}