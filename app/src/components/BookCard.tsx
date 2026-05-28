import { useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import type { Book } from "../api";

interface Props {
  book: Book;
  onSelect: (book: Book) => void;
}

// A single focusable catalog tile. `focused` is driven by spatial navigation,
// so moving the remote's D-pad highlights tiles and OK/Enter selects one.
export function BookCard({ book, onSelect }: Props) {
  const { ref, focused } = useFocusable({
    focusKey: `book-${book.id}`,
    onEnterPress: () => onSelect(book),
  });

  return (
    <div ref={ref} className={`card${focused ? " card--focused" : ""}`}>
      <h3 className="card__title">{book.title}</h3>
      <p className="card__author">
        {book.author}
        {book.year != null ? ` · ${book.year}` : ""}
      </p>
      {book.category && <span className="card__tag">{book.category}</span>}
      {book.description && <p className="card__desc">{book.description}</p>}
    </div>
  );
}
