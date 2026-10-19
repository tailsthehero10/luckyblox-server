import GameGrid from '../components/GameGrid';
import { fetchGames } from '../lib/backend';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Games - LuckyBlox' };

export default async function GamesPage() {
  const { games, error } = await fetchGames();

  return (
    <>
      <h1 className="lb-title">Games</h1>
      <p className="lb-subtitle">{games.length} experience{games.length === 1 ? '' : 's'} available.</p>
      <GameGrid games={games} error={error} />
    </>
  );
}