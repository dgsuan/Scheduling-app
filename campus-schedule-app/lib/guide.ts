// Content for the in-app Guide (app/guide.tsx) and the "New in this update"
// banner on Home. Bump GUIDE_VERSION when WHATS_NEW changes so everyone sees
// the banner once more.

export const GUIDE_VERSION = 4;

export type WhatsNewItem = { title: string; body: string; where: string; href?: string };

export const WHATS_NEW: WhatsNewItem[] = [
  {
    title: "Task board & Friend activity",
    body: "Drag tasks between Not started, Doing and Finished. Share what you're doing with your class sections and people you've shared courses with.",
    where: "Tasks → Board",
    href: "/tasks",
  },
  {
    title: "Upload your Form 5",
    body: "Pick your Form 5 PDF and your classes, times and rooms fill in. It's read on your device.",
    where: "Import → Upload Form 5 (PDF)",
    href: "/import",
  },
  {
    title: "Heavy-day warnings",
    body: "Home warns you when a day piles up, like 2 classes and 3 deadlines.",
    where: "Home, under today's date",
    href: "/",
  },
  {
    title: "Focus time per course",
    body: "See where this week's focus-timer time went, and which course has deadlines but no study time.",
    where: "Home → Focus time",
    href: "/",
  },
  {
    title: "Room finder",
    body: "Tap a room to see your classes there, your next time there, and how long you have to walk from your previous class.",
    where: "Home → tap an underlined room",
    href: "/",
  },
  {
    title: "“What do I need?”",
    body: "Pick a target grade and see the average you need on what's left, using the UP scale.",
    where: "Courses → Grades",
    href: "/courses",
  },
  {
    title: "Enlistment planner",
    body: "Paste the class offerings from CRS, pick a section per course, and see clashes before enlistment.",
    where: "Courses → Plan enlistment",
    href: "/planner",
  },
  {
    title: "End semester & overall GWA",
    body: "Archive this term's courses and grades, start fresh, and keep a GWA across semesters.",
    where: "Settings → Semester",
    href: "/settings",
  },
  {
    title: "Linked notes",
    body: "Link a task to a notebook or folder and open it straight from the task.",
    where: "Tasks → edit a task → Notes",
    href: "/tasks",
  },
  {
    title: "More from class sections",
    body: "“I submitted it” counts, comments on deadlines, shared free times, read-only shared notes, and a public deadlines link.",
    where: "Tasks → Class sections",
    href: "/tasks?sections=1",
  },
  {
    title: "Calendar links that stay in sync",
    body: "Save your UVLE calendar link once; new and changed deadlines are added automatically.",
    where: "Import → Keep a calendar link in sync",
    href: "/import",
  },
  {
    title: "Reminders when the app is closed",
    body: "Get class and deadline reminders as real notifications, even with every tab closed.",
    where: "Settings → Reminders",
    href: "/settings",
  },
  {
    title: "Search text inside images",
    body: "Photos of slides and board notes become searchable with Ctrl+K. Read on your device.",
    where: "Settings → Search",
    href: "/settings",
  },
  {
    title: "Sync status and shortcuts",
    body: "The sidebar shows if your changes are synced. Installed app? Long-press its icon for Add task, Today and Calendar.",
    where: "Sidebar · installed app icon",
  },
];

export type GuideStep = { title: string; body?: string; isNew?: boolean };

export type GuideSection = {
  id: string;
  title: string;
  summary: string;
  /** Numbered only when the steps are a real sequence. */
  ordered?: boolean;
  steps: GuideStep[];
  link?: { label: string; href: string };
};

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "start",
    title: "Getting started",
    summary: "Set up a semester in about a minute.",
    ordered: true,
    steps: [
      { title: "Add your classes", body: "Import → Upload Form 5 (PDF), or paste your schedule from CRS. Or add them one by one in Courses → Add course." },
      { title: "Set your semester dates", body: "Settings → Semester. Classes then stop at the end of the term and skip holidays." },
      { title: "Sign in to sync", body: "Settings → Account & sync. Your data follows you between your phone and laptop." },
      { title: "Join your block's section", body: "Tasks → Class sections → Join with a code, so classmates' deadlines show up in your Tasks." },
      { title: "Install the app", body: "Settings → Install, so it opens like a regular app and works offline." },
    ],
    link: { label: "Paste from CRS", href: "/import" },
  },
  {
    id: "home",
    title: "Home",
    summary: "What's happening now, next, and later today.",
    steps: [
      { title: "Now / Next card", body: "Shows the class you're in or the next one, and counts down to it." },
      { title: "Heavy days", body: "A warning appears when a day this week has lots of classes and deadlines.", isNew: true },
      { title: "Focus time", body: "Your focus-timer time per course this week, with a warning for courses you're falling behind on.", isNew: true },
      { title: "Tap a room", body: "Rooms under later classes are underlined — tap one for your classes there and your walking time.", isNew: true },
      { title: "Quick add", body: "Type in “Add a task for today…” and press Enter." },
    ],
    link: { label: "Go to Home", href: "/" },
  },
  {
    id: "tasks",
    title: "Tasks",
    summary: "Deadlines, steps, repeats and the focus timer.",
    steps: [
      { title: "Add a task", body: "Type a title, then set a due date, time, priority, course or repeat below it." },
      { title: "Steps", body: "Hover a task (or tap it on a phone) and use the list icon to break it into steps." },
      { title: "Focus timer", body: "The timer icon starts a session; the time is saved on the task when you stop." },
      { title: "Link notes", body: "Edit a task → Notes → pick a notebook or folder. Open it from the task later.", isNew: true },
      { title: "Board", body: "Switch to Board and drag tasks between Not started, Doing and Finished — or use Start and Done on each card.", isNew: true },
      {
        title: "Friend activity",
        body: "Turn on “Share what I'm doing” so classmates in your sections and people you've shared courses with see your Doing task. The lock on a card keeps that task private.",
        isNew: true,
      },
      { title: "Undo", body: "Deleted something by mistake? Press Undo on the message that pops up." },
    ],
    link: { label: "Go to Tasks", href: "/tasks" },
  },
  {
    id: "sections",
    title: "Class sections",
    summary: "Shared deadlines with your block or class. Needs an account.",
    steps: [
      { title: "Create or join", body: "Tasks → Class sections. The owner shares a 10-character invite code or link." },
      { title: "Post a deadline", body: "It appears in every member's Tasks, Calendar and reminders." },
      { title: "I submitted it", body: "Tick it (or finish the task) to add to the “submitted” count.", isNew: true },
      { title: "Comments", body: "Ask “is it due Friday or Monday?” right under the deadline.", isNew: true },
      { title: "Free times", body: "Share your class hours (not which classes) to find when everyone's free for group work.", isNew: true },
      { title: "Shared notes", body: "Share a notebook or folder as read-only text notes and to-do lists.", isNew: true },
      { title: "Public deadlines page", body: "Owners can make a link that shows only titles and due dates — good for pinning in the group chat.", isNew: true },
      { title: "Owner controls", body: "Remove or ban members, change the invite code, or delete the section." },
    ],
    link: { label: "Open Class sections", href: "/tasks?sections=1" },
  },
  {
    id: "calendar",
    title: "Calendar",
    summary: "Month and week views of classes, tasks, events and dated notes.",
    steps: [
      { title: "Add something", body: "Drag across days (or click a time in the week view) to create a task, event or note." },
      { title: "Cancel one class", body: "Click a class → Cancel this class. Only that day changes; the weekly schedule stays." },
      { title: "Getting there", body: "A class's details show how long you have after your previous class.", isNew: true },
      { title: "Export", body: "Export your schedule as an .ics file for Google Calendar and others." },
    ],
    link: { label: "Go to Calendar", href: "/calendar" },
  },
  {
    id: "courses",
    title: "Courses & grades",
    summary: "Your classes, grade books, GWA, sharing and enlistment planning.",
    steps: [
      { title: "Grades", body: "Courses → Grades: set component weights (e.g. Quizzes 20%) and log scores." },
      { title: "What do I need?", body: "In Grades, pick a target like 1.75 to see the average you need on what's left.", isNew: true },
      { title: "GWA", body: "Shown at the top of Courses, plus an overall GWA once you've ended a semester.", isNew: true },
      { title: "Share a course", body: "Share → give classmates the code; they add it with “Add shared course”. Notes and grades are never shared." },
      { title: "Plan enlistment", body: "Paste CRS offerings, pick sections, fix clashes, then add them to Courses.", isNew: true },
    ],
    link: { label: "Go to Courses", href: "/courses" },
  },
  {
    id: "notes",
    title: "Notes",
    summary: "A canvas per course, plus a General one.",
    steps: [
      { title: "Add to the canvas", body: "Sticky notes, to-do lists, images, files and drawings. Drag things around freely." },
      { title: "Folders", body: "Group notes into folders; open one to see what's inside." },
      { title: "Dated notes", body: "Give a note a date and it shows on the Calendar too." },
      { title: "Images", body: "Click an image to view it larger, or edit it (crop, rotate)." },
      { title: "Search", body: "Press Ctrl+K to find any note. Turn on text-in-images search in Settings → Search.", isNew: true },
    ],
    link: { label: "Go to Notes", href: "/notes" },
  },
  {
    id: "import",
    title: "Import",
    summary: "Bring in classes from CRS and deadlines from UVLE.",
    steps: [
      { title: "Form 5 PDF", body: "Upload Form 5 (PDF) reads your classes straight from the file, on your device.", isNew: true },
      { title: "CRS schedule", body: "Or copy the enlisted classes table from CRS and paste it. Courses, times and rooms fill in." },
      { title: "UVLE file", body: "In UVLE: Calendar → Export calendar → Export, then upload the .ics file." },
      { title: "Keep a link in sync", body: "Save your UVLE calendar link once and new deadlines keep arriving on their own.", isNew: true },
    ],
    link: { label: "Go to Import", href: "/import" },
  },
  {
    id: "settings",
    title: "Settings",
    summary: "Account, semester, reminders, look and feel, backups.",
    steps: [
      { title: "Account & sync", body: "Sign in, check sync status, see changes replaced by another device, or delete your account." },
      { title: "Semester", body: "Term dates, holiday skipping, cancelled classes, End semester and Past semesters.", isNew: true },
      { title: "Reminders", body: "Before classes and deadlines — and, new, even when the app is closed.", isNew: true },
      { title: "Appearance", body: "Theme, colors, fonts and size. The look shifts gently with the time of day." },
      { title: "Search", body: "Find text inside images.", isNew: true },
      { title: "Backup", body: "Export everything to a file, or restore from one." },
    ],
    link: { label: "Go to Settings", href: "/settings" },
  },
  {
    id: "tips",
    title: "Tips",
    summary: "Small things that save time.",
    steps: [
      { title: "Ctrl+K", body: "Search tasks, events, notes and courses, or jump anywhere." },
      { title: "Works offline", body: "Everything saves on your device first. With an account, it syncs when you're back online." },
      { title: "Your data stays yours", body: "Without an account nothing leaves your device. With one, only you can see your data." },
    ],
  },
];
