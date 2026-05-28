import { useEffect, useState } from "react";
import { fetchBooks, type Book } from "./api";
import { BookGrid } from "./components/BookGrid";

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Book | null>(null);

  useEffect(() => {
    fetchBooks()
      .then(setBooks)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>Temple Library</h1>
        <p className="subtitle">
          Welcome — browse the catalog with your remote. Use the arrows to move,
          OK to open a book.
        </p>
      </header>

      {error && <p className="error">{error}</p>}

      <BookGrid books={books} onSelect={setSelected} />

      {selected && (
        <p className="selection">
          Selected: <strong>{selected.title}</strong> by {selected.author}
        </p>
      )}
    </div>
  );
}
