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

test("a UP Manila Form 5: fee table beside the classes, address below", () => {
  const text = [
    "UP FORM 5. UNIVERSITY OF THE PHILIPPINES MANILA CERTIFICATE OF REGISTRATION",
    "STUDENT NO.  202500000  NAME:  DELA CRUZ, JUAN",
    "CLASS  SUBJECT  SECTION  UNITS  SCHEDULE & ROOM  LAB FEE  Cashier:",
    "CODE  Register:",
    "10690  BIO 110  LEC5  5  MTh 10:00AM-11:30AM  Mode:",
    "10677  BIO 110  LB5A  MTh 01:00PM-04:00PM  Amount:",
    "11255  BS 101  TFE  3  TF 01:00PM-02:30PM  ITEM  CODE  AMOUNT",
    "10058  PA 1  TFI  3  TF 04:00PM-05:30PM  Tuition for Academic Courses  30,000.00",
    "10126  PE 2ICD  WBC  2  W 09:00AM-11:00AM  NSTP Tuition  0.00",
    "11264  PSYCH 150  MHB  3  MTh 08:30AM-10:00AM  Admission Fees  0.00",
    "11266  SOC SCI 150  TFG  3  TF 02:30PM-04:00PM  Entrance Fees  0.00",
    "11287  SOC SCI RES 192  TFC  3  TF 10:00AM-11:30AM  Registration Fees  40.00",
    "************ nothing follows ************  Library Fees  1,100.00",
    "Total Number of Units: 20  Reasons for underloading (if underloaded):",
    "Present Address:  Tel No.",
    "Block 4 Lot 10 Sitio Libjo Barangay Sto. Nino Paranaque City National Capital Region  09170000000",
    "1704",
  ].join("\n");
  const { courses, warnings } = parseCrs(text);
  assert.deepEqual(
    courses.map((c) => `${c.code} ${c.section} ${c.meetings.map((m) => `${m.days.join("")} ${m.start}-${m.end} ${m.room ?? "-"}`).join(",")}`),
    [
      "BIO 110 LEC5 14 10:00-11:30 -",
      "BIO 110 LB5A 14 13:00-16:00 -",
      "BS 101 TFE 25 13:00-14:30 -",
      "PA 1 TFI 25 16:00-17:30 -",
      "PE 2ICD WBC 3 09:00-11:00 -",
      "PSYCH 150 MHB 14 08:30-10:00 -",
      "SOC SCI 150 TFG 25 14:30-16:00 -",
      "SOC SCI RES 192 TFC 25 10:00-11:30 -",
    ]
  );
  assert.deepEqual(warnings, [], "the address isn't a class and isn't mentioned");
});

console.log(`all ${passed} PDF test groups passed`);
