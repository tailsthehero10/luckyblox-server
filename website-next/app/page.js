import GameGrid from './components/GameGrid';
import { fetchGames } from './lib/backend';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { games, error } = await fetchGames();

  return (
    <>
      <h1 className="lb-title">Discover experiences</h1>
      <p className="lb-subtitle">
        Every game runs on the LuckyBlox client of its era.
      </p>
      <GameGrid games={games} error={error} />
    </>
  );
}