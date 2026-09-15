// Turns the positioned text pieces a PDF gives us back into table rows, so a
// Form 5 reads like text copied from CRS: pieces on the same line joined in
// order, with a wide gap (a new column) kept as two spaces — which the CRS
// reader uses to tell the room apart from the next column.

export type PdfTextItem = { str: string; x: number; y: number; width: number; height?: number };

export function linesFromTextItems(items: PdfTextItem[], yTolerance = 3): string[] {
  const pieces = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const piece of pieces) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - piece.y) <= yTolerance) row.push(piece);
    else rows.push([piece]);
  }
  return rows.map((row) => {
    let line = "";
    let end = -Infinity;
    for (const piece of [...row].sort((a, b) => a.x - b.x)) {
      const gap = piece.x - end;
      const size = piece.height && piece.height > 0 ? piece.height : 10;
      if (line) line += gap > size * 0.9 ? "  " : gap > size * 0.12 ? " " : "";
      line += piece.str.trim();
      end = piece.x + piece.width;
    }
    return line;
  });
}

export function textFromPages(pages: PdfTextItem[][]): string {
  return pages.flatMap((page) => linesFromTextItems(page)).join("\n");
}
