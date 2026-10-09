import type { LibraryEntry } from "../library/drawingLibrary";

export type LibrarySort = "name" | "recent" | "size";

export function filterAndSortEntries(
  entries: readonly LibraryEntry[], query: string, sort: LibrarySort, locale: string,
): LibraryEntry[] {
  const search = query.normalize("NFKC").trim().toLocaleLowerCase(locale);
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return entries
    .filter((entry) => entry.name.normalize("NFKC").toLocaleLowerCase(locale).includes(search))
    .sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
      if (sort === "recent" && left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
      if (sort === "size" && left.kind === "drawing" && right.kind === "drawing" && left.size !== right.size) {
        return right.size - left.size;
      }
      return collator.compare(left.name, right.name);
    });
}
