import { useEffect } from "react";
import {
  FocusContext,
  useFocusable,
  setFocus,
} from "@noriginmedia/norigin-spatial-navigation";
import type { Book } from "../api";
import { BookCard } from "./BookCard";

interface Props {
  books: Book[];
  onSelect: (book: Book) => void;
}

// Wraps the tiles in a focusable container and drops initial focus onto the
// first card once data arrives, so the remote has somewhere to start.
export function BookGrid({ books, onSelect }: Props) {
  const { ref, focusKey } = useFocusable();

  useEffect(() => {
    if (books.length > 0) setFocus(`book-${books[0].id}`);
  }, [books]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="grid">
        {books.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            onSelect={onSelect}
          />
        ))}
      </div>
    </FocusContext.Provider>
  );
}
