// Philippine holidays for the calendar.
//
// IMPORTANT — accuracy caveat: the Philippines sets holidays by an annual
// Malacañang proclamation. Fixed-date holidays below are stable year to
// year, but:
//   - Holy Week (Maundy Thursday / Good Friday / Black Saturday) moves with
//     Easter and is computed per year here.
//   - Chinese New Year moves with the lunar calendar (hard-coded per year).
//   - Eid'l Fitr and Eid'l Adha depend on moon sighting and are only
//     *confirmed* by proclamation a few weeks out — the dates here are
//     best-estimate approximations, flagged with `approx: true`.
//   - Some "special non-working" days (EDSA anniversary, All Souls' Day,
//     Christmas Eve, Last Day of the Year) have been included/excluded or
//     moved in specific years' proclamations.
// Always confirm against the official proclamation for the year in question.

export type HolidayType = "regular" | "special";

export type Holiday = {
  /** ISO date, YYYY-MM-DD (local calendar date, no timezone). */
  date: string;
  name: string;
  type: HolidayType;
  /** true when the date is a moon-sighting / proclamation estimate. */
  approx?: boolean;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(year: number, month1: number, day: number): string {
  return `${year}-${pad(month1)}-${pad(day)}`;
}

/** Anonymous Gregorian (Meeus/Jones/Butcher) algorithm for Easter Sunday. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toIso(date: Date): string {
  return iso(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Last Monday of August — National Heroes Day. */
function lastMondayOfAugust(year: number): string {
  const d = new Date(year, 7, 31); // Aug 31
  while (d.getDay() !== 1) d.setDate(d.getDate() - 1);
  return toIso(d);
}

// Lunar / Islamic holidays that can't be computed simply. Extend this as
// official proclamations come out.
const CHINESE_NEW_YEAR: Record<number, string> = {
  2025: "2025-01-29",
  2026: "2026-02-17",
  2027: "2027-02-06",
  2028: "2028-01-26",
};

const EID_AL_FITR: Record<number, string> = {
  2025: "2025-03-31",
  2026: "2026-03-20",
  2027: "2027-03-10",
  2028: "2028-02-27",
};

const EID_AL_ADHA: Record<number, string> = {
  2025: "2025-06-06",
  2026: "2026-05-27",
  2027: "2027-05-17",
  2028: "2028-05-05",
};

export function getHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const maundyThursday = addDays(easter, -3);
  const goodFriday = addDays(easter, -2);
  const blackSaturday = addDays(easter, -1);

  const list: Holiday[] = [
    // --- Regular holidays ---
    { date: iso(year, 1, 1), name: "New Year's Day", type: "regular" },
    { date: toIso(maundyThursday), name: "Maundy Thursday", type: "regular" },
    { date: toIso(goodFriday), name: "Good Friday", type: "regular" },
    { date: iso(year, 4, 9), name: "Araw ng Kagitingan (Day of Valor)", type: "regular" },
    { date: iso(year, 5, 1), name: "Labor Day", type: "regular" },
    { date: iso(year, 6, 12), name: "Independence Day", type: "regular" },
    { date: lastMondayOfAugust(year), name: "National Heroes Day", type: "regular" },
    { date: iso(year, 11, 30), name: "Bonifacio Day", type: "regular" },
    { date: iso(year, 12, 25), name: "Christmas Day", type: "regular" },
    { date: iso(year, 12, 30), name: "Rizal Day", type: "regular" },

    // --- Special (non-working) days ---
    { date: toIso(blackSaturday), name: "Black Saturday", type: "special" },
    { date: iso(year, 2, 25), name: "EDSA People Power Revolution Anniversary", type: "special" },
    { date: iso(year, 8, 21), name: "Ninoy Aquino Day", type: "special" },
    { date: iso(year, 11, 1), name: "All Saints' Day", type: "special" },
    { date: iso(year, 11, 2), name: "All Souls' Day", type: "special" },
    { date: iso(year, 12, 8), name: "Feast of the Immaculate Conception", type: "special" },
    { date: iso(year, 12, 24), name: "Christmas Eve", type: "special" },
    { date: iso(year, 12, 31), name: "Last Day of the Year", type: "special" },
  ];

  const cny = CHINESE_NEW_YEAR[year];
  if (cny) list.push({ date: cny, name: "Chinese New Year", type: "special" });

  const eidFitr = EID_AL_FITR[year];
  if (eidFitr)
    list.push({ date: eidFitr, name: "Eid'l Fitr (End of Ramadan)", type: "regular", approx: true });

  const eidAdha = EID_AL_ADHA[year];
  if (eidAdha)
    list.push({ date: eidAdha, name: "Eid'l Adha (Feast of Sacrifice)", type: "regular", approx: true });

  return list.sort((a, b) => a.date.localeCompare(b.date));
}

const cache = new Map<number, Map<string, Holiday[]>>();

/** All holidays for `year`, indexed by ISO date (a date can have >1). */
export function holidayMap(year: number): Map<string, Holiday[]> {
  let byDate = cache.get(year);
  if (!byDate) {
    byDate = new Map();
    for (const h of getHolidays(year)) {
      const existing = byDate.get(h.date);
      if (existing) existing.push(h);
      else byDate.set(h.date, [h]);
    }
    cache.set(year, byDate);
  }
  return byDate;
}

export function holidaysOn(isoDate: string): Holiday[] {
  const year = Number(isoDate.slice(0, 4));
  return holidayMap(year).get(isoDate) ?? [];
}
