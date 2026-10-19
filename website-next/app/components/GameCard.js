'use client';

/**
 * One game card.
 *
 * This is a CLIENT component for one reason: the `onError` handler that swaps a
 * missing artwork for the placeholder. A Server Component cannot pass a function
 * to a DOM event, and doing so made React 19 fail the whole page with an error
 * digest (HTTP 500 on /games) while still streaming partial markup - which is
 * why the cards appeared in the HTML but the response was an error.
 */
export default function GameCard({ game }) {
  return (
    <a className="lb-card" href={`/games/${game.placeId}`}>
      <img
        className="lb-card-art"
        src={game.icon}
        alt=""
        loading="lazy"
        onError={(event) => {
          // Reveal the placeholder instead of a broken image icon.
          event.currentTarget.src = '/gameplaceholder/card.png';
        }}
      />
      <div className="lb-card-body">
        <p className="lb-card-title" title={game.title}>{game.title}</p>
        <div className="lb-card-meta">
          <span>{game.playing} playing</span>
          {game.clientYear ? <span>{game.clientYear}</span> : null}
        </div>
      </div>
    </a>
  );
}