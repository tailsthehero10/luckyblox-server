import GameGrid from '../components/GameGrid';
import { fetchGames } from '../lib/backend';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Home - LuckyBlox' };

/**
 * The signed-in home page.
 *
 * The reference site separates `/home` (the logged-in landing) from `/` (the
 * public front page), so this mirrors that split rather than showing one page
 * for both states.
 */
export default async function HomePage() {
  const { games, error } = await fetchGames();

  return (
    <>
      <h1 className="lb-title">Home</h1>
      <p className="lb-subtitle">Pick up where you left off.</p>
      <GameGrid games={games} error={error} />
    </>
  );
}