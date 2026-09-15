import assert from "node:assert/strict";

import { parseCrs } from "@/lib/crs";
import { linesFromTextItems, textFromPages, type PdfTextItem } from "@/lib/pdfLines";

let passed = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

/** A cell of a PDF table: text at x, on a row at y (PDF y grows upward), 10pt type. */
const cell = (str: string, x: number, y: number): PdfTextItem => ({ str, x, y, width: str.length * 5, height: 10 });

test("PDF text pieces become table rows", () => {
  const items = [
    cell("TTh 10:00AM-11:30AM", 230, 700.5),
    cell("54321", 20, 700),
    cell("CMSC 21", 70, 700),
    cell("T-3L", 115, 700),
    cell("3.0", 180, 700),
    cell("AECH Accenture Rm", 350, 700),
    cell("DELA CRUZ, J", 470, 700),
    cell("Class Code", 20, 720),
    cell("54322", 20, 680),
    cell("MATH 21 THY2", 70, 680),
    cell("   ", 100, 680),
  ];
  assert.deepEqual(linesFromTextItems(items), [
    "Class Code",
    "54321  CMSC 21  T-3L  3.0  TTh 10:00AM-11:30AM  AECH Accenture Rm  DELA CRUZ, J",
    "54322  MATH 21 THY2",
  ]);
  const glued = [cell("CMS", 10, 50), { str: "C 21", x: 25, y: 50, width: 20, height: 10 }];
  assert.deepEqual(linesFromTextItems(glued), ["CMSC 21"], "pieces touching each other join without a space");
});

test("a Form 5 read from PDF gives courses with rooms, not instructors", () => {
  const page1 = [
    cell("Form 5 (Certificate of Registration)", 20, 800),
    cell("Page 1 of 1", 470, 800),
    cell("1st Semester AY 2026-2027", 20, 780),
    cell("Total units 7.0", 20, 700),
    cell("Class Code", 20, 760),
    cell("Class", 70, 760),
    cell("Units", 180, 760),
    cell("Schedule", 230, 760),
    cell("Room", 350, 760),
    cell("Instructor", 470, 760),
    cell("54321", 20, 740),
    cell("CMSC 21", 70, 740),
    cell("T-3L", 115, 740),
    cell("3.0", 180, 740),
    cell("TTh 10:00 AM - 11:30 AM", 230, 740),
    cell("AECH Accenture Rm", 350, 740),
    cell("DELA CRUZ, J", 470, 740),
    cell("54323", 20, 720),
    cell("MATH 21 THY2", 70, 720),
    cell("4.0", 180, 720),
    cell("MWF 7:00AM-8:00AM", 230, 720),
    cell("MB 101", 350, 720),
    cell("SANTOS, A", 470, 720),
  ];
  const { courses } = parseCrs(textFromPages([page1]));
  assert.deepEqual(
    courses.map((c) => [c.code, c.section, c.units, c.meetings.map((m) => `${m.days.join("")} ${m.start}-${m.end} ${m.room}`)]),
    [
      ["CMSC 21", "T-3L", 3, ["24 10:00-11:30 AECH Accenture Rm"]],
      ["MATH 21", "THY2", 4, ["135 07:00-08:00 MB 101"]],
    ]
  );
});

console.log(`all ${passed} PDF test groups passed`);
