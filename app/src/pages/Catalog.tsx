import { useEffect, useState } from "react";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation";
import { api, type Book } from "../lib/api";
import { useRemoteBack } from "../lib/useRemoteBack";
import { Grid } from "../components/Grid";
import { Tile } from "../components/Tile";

export function Catalog() {
  useRemoteBack();
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .books()
      .then(setBooks)
      .catch(() => setError("Could not load the catalog."));
  }, []);

  useEffect(() => {
    if (books.length > 0) setFocus(`book-${books[0].id}`);
  }, [books]);

  return (
    <div className="page">
      <header className="page__header">
        <h1 className="page__title">Catalog</h1>
      </header>

      {error && <p className="error">{error}</p>}

      <Grid className="grid grid--cards">
        {books.map((book) => (
          <Tile key={book.id} focusKey={`book-${book.id}`} className="tile--card">
            <h3 className="tile__title">{book.title}</h3>
            <p className="tile__meta">
              {book.author}
              {book.year != null ? ` · ${book.year}` : ""}
            </p>
            {book.category && <span className="tag">{book.category}</span>}
            {book.description && <p className="tile__desc">{book.description}</p>}
          </Tile>
        ))}
      </Grid>
    </div>
  );
}
