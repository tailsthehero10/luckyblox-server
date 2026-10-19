import GameCard from './GameCard';

/**
 * The game grid.
 *
 * A real <img> per card (never a CSS background-image) so a missing asset shows
 * the placeholder rather than an empty tinted box. The grid is
 * `auto-fill`/`minmax`, so it reflows on every screen size instead of relying
 * on fixed column counts.
 *
 * Each card is its own Client Component because it carries an image `onError`
 * handler. Passing that function straight from this Server Component is what
 * made React 19 fail /games with an error digest while still streaming markup.
 */
export default function GameGrid({ games, error }) {
  if (error) {
    return <div className="lb-empty">{error}</div>;
  }

  if (!Array.isArray(games) || games.length === 0) {
    return <div className="lb-empty">No games have been published yet.</div>;
  }

  return (
    <div className="lb-grid">
      {games.map((game) => (
        <GameCard key={game.placeId} game={game} />
      ))}
    </div>
  );
}