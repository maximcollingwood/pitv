export interface Book {
  id: number;
  title: string;
  author: string;
  year: number | null;
  category: string | null;
  description: string | null;
}

export async function fetchBooks(): Promise<Book[]> {
  const res = await fetch("/api/books");
  if (!res.ok) throw new Error(`Failed to load books (${res.status})`);
  return res.json();
}
