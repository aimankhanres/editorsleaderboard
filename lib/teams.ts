/**
 * The editors shown on the dashboard, one board per team (from the Creative Production org chart, Nov 2026).
 * `id` is the ClickUp user id (the app keys editors as `u:<id>`), so name changes in ClickUp don't matter.
 * `id: null` = not a member of Resilia's ClickUp workspace (most Agency editors work in the agency workspace), so
 * no spend or tasks can be traced to them here; they are listed so the roster is complete.
 * People on two teams (e.g. Kenny: Garlic Internal + Garlic Variations) are listed on both.
 * `kpi`: edits per day / per week (Farwa, Nov 2026): Resizing 2/day and 14/week; every other team 1/day, 5/week.
 * `nameCheck`: include in the "ad name mentions a different editor" check (only the original three boards).
 * To add or move someone: add a line here with their ClickUp user id (Workspace settings → People), commit, push.
 */
export type TeamMember = { id: number | null; name: string; role: string };
export type TeamKpi = { perDay: number; perWeek: number };
export type TeamGroup = 'Resizing' | 'Iterations' | 'Internal' | 'Variations' | 'Agency';
export type Team = {
  id: string; name: string; group: TeamGroup; kpi: TeamKpi; nameCheck?: boolean;
  /** false: edits happen in another ClickUp workspace, so capacity can't be measured here (Agency teams) */
  capacity?: boolean;
  members: TeamMember[];
};

const RESIZE = 'Video Editor – Resizing';
const GOOGLE = 'Video Editor – Google';
const KPI_RESIZING: TeamKpi = { perDay: 2, perWeek: 14 };
const KPI_STANDARD: TeamKpi = { perDay: 1, perWeek: 5 };

/** Dashboard key of a member: their ClickUp user, or their name when they are not in our ClickUp */
export const memberKey = (m: TeamMember) => (m.id ? `u:${m.id}` : `n:${m.name.trim().toLowerCase()}`);

export const TEAMS: Team[] = [
  {
    id: 'resizing', name: 'Resizing', group: 'Resizing', kpi: KPI_RESIZING, nameCheck: true,
    members: [
      { id: 106853412, name: 'Michael Roque', role: 'Editing Lead – Resizing' },
      { id: 100998805, name: 'Usama Mir', role: RESIZE },
      { id: 106853413, name: 'Aqib Shakeel', role: RESIZE },
      { id: 106853410, name: 'Dustin Bryan', role: RESIZE },
      { id: 101080547, name: 'Armand Lladones', role: RESIZE },
      { id: 101095615, name: 'Jerry Emmanuel', role: RESIZE },
      { id: 101097538, name: 'Tope Ojomo', role: RESIZE },
      { id: 106838108, name: 'Neil Dave', role: RESIZE },
      { id: 106857511, name: 'Lucky Jake Tapayan', role: RESIZE },
      { id: 228272515, name: 'Haseeb Choudhary', role: RESIZE },
      { id: 106863134, name: 'Adilbek Sultanov', role: RESIZE },
      { id: 106875777, name: 'Saif Adam', role: RESIZE },
      { id: 106887813, name: 'Jay-el Tobias', role: RESIZE },
      { id: 106886793, name: 'Gagandeep Kumar', role: RESIZE },
      { id: 118486912, name: 'Vansh Ahluwalia', role: RESIZE },
      { id: 118443310, name: 'Jude Elega', role: RESIZE },
      { id: 118467311, name: 'Zamad Khan', role: RESIZE },
      { id: 106916528, name: 'Omer Aayan', role: RESIZE },
      { id: 106916546, name: 'Mian Muhammad Nasir', role: RESIZE },
      { id: 106917826, name: 'Thai Anh Tu', role: RESIZE },
      { id: 106917204, name: 'Muhammad Bilal', role: RESIZE },
      { id: 106917822, name: 'Yahya Syed', role: RESIZE },
      { id: 106919231, name: 'Kiran Akash', role: RESIZE },
      { id: 106919235, name: 'Sidra Nazish', role: RESIZE },
      { id: 106917202, name: 'Amna Tanveer', role: RESIZE },
      { id: 106919261, name: 'Arslan Sahabrso', role: RESIZE },
      { id: 106919268, name: 'Rehman Khan', role: RESIZE },
      { id: 106919233, name: 'Manu Bhardwaj', role: 'Video Editor – Resizing' }, // not on the Nov 2026 org chart; added from ClickUp activity (Garlic Resizing)
      // Rips editors (merged into Resizing, Nov 26 2026)
      { id: 106853409, name: 'Clariz Barrera', role: 'Senior Editor – Resizing' },
      { id: 106886777, name: 'Ayyaz Sohail', role: 'Sr. Editor' },
      { id: 106853408, name: 'Cristian Jay Reyes', role: 'Editing Lead – Resizing' },
      { id: 106842654, name: 'Jasmin Marinay', role: RESIZE },
      { id: 101069834, name: 'Lucylen (Lucy) Pagado', role: RESIZE },
    ],
  },
  {
    id: 'iterations', name: 'Iterations', group: 'Iterations', kpi: KPI_STANDARD, nameCheck: true,
    members: [
      { id: 106853401, name: 'Damia Tasleem', role: 'Lead Editor – Iterations' },
      { id: 106838067, name: 'Ginika Mary', role: GOOGLE },
      { id: 106884332, name: 'Amna Sajjad', role: 'Editor – Google' }, // "Amna S" in the request
      { id: 106859606, name: 'Konstantin Oberemov', role: GOOGLE },
      { id: 106909701, name: 'Ivan Zelentsov', role: GOOGLE },
      { id: 106893212, name: 'Chioma Okeke', role: GOOGLE },
      { id: 106886772, name: 'Kseniia Pykhova', role: GOOGLE },
      { id: 106899216, name: 'Stanislav Golubev', role: GOOGLE },
      { id: 106898268, name: 'Aleksandr Lagodzinskii', role: GOOGLE },
      { id: 106803039, name: 'Alexander Logutov', role: GOOGLE }, // "Alex" in the request
      { id: 106853411, name: 'Vincent Adalla', role: GOOGLE },
      { id: 106927446, name: 'Jhonathan Nascimento', role: GOOGLE },
      { id: 106861248, name: 'Dmitrii Bondarev', role: GOOGLE },
      { id: 106850985, name: 'Rolling Gonzalez', role: GOOGLE },
      { id: 106926186, name: 'Anum Naqvi', role: 'Editor – Google Iterations' },
      { id: 106838082, name: 'Abdul Qadir', role: GOOGLE }, // added from the Nov 2026 org chart
    ],
  },
  {
    id: 'oregano-internal', name: 'Oregano Internal', group: 'Internal', kpi: KPI_STANDARD,
    members: [
      { id: 106833614, name: 'Ammruta Paalo', role: 'Lead Editor' },
      { id: 106888872, name: 'Adrian Eryz San Juan', role: 'Senior Editor' },
      { id: 106899956, name: 'Israel Adeyemi', role: 'Senior Editor' },
      { id: 101096563, name: 'Faraz Ali Shaikh', role: 'Senior Editor' },
      { id: 101072103, name: 'Zeeshan', role: 'Base Editor' }, // "Zeeshan" (zeeshan.ahmed@) in ClickUp: Oregano tasks
      { id: 99954521, name: 'Huraira Jalil', role: 'Base Editor' },
      { id: 106919312, name: 'Nora Rakaiby', role: 'Base Editor' },
      { id: 100998803, name: 'Angelo Baltazar', role: 'Base Editor' },
      { id: null, name: 'Mark Lawrence Garilao', role: 'Base Editor' }, // not found in ClickUp
      { id: 106902016, name: 'Erica Matanggo', role: 'Base Editor' },
      { id: 312745023, name: 'Shadrach Devilla', role: 'Base Editor' },
      { id: 101069812, name: 'Wade Parreno', role: 'Base Editor' },
      { id: 101069764, name: 'Andy Lumabong', role: 'Base Editor' },
      { id: 106812224, name: 'Zy Santos', role: 'Base Editor' },
      { id: 101097542, name: 'Kaloyan Nikolov', role: 'Base Editor' },
      { id: 312886031, name: 'Hanna Sanjuan', role: 'Base Editor' },
      { id: 60426829, name: 'Mohsin Riaz', role: 'Base Editor' },
      { id: 101097529, name: 'Karan Singh', role: 'Base Editor' },
      { id: 314490502, name: 'Ashutosh Bisht', role: 'Base Editor' },
      { id: 106902216, name: 'Sakshi Bisht', role: 'Base Editor' },
      { id: 101084642, name: 'Muhammad Issa', role: 'Base Editor' }, // "Mhamad Issa" in ClickUp
      { id: 101069837, name: 'John Paulo Cataquiz', role: 'Base Editor' }, // John Paulo Cataquiz in ClickUp: the John with Oregano tasks
      { id: 312885998, name: 'Mark Imbing', role: 'Base Editor' }, // not on the Nov 2026 org chart; added from ClickUp activity (Oil of Oregano pipeline)
      { id: 106927448, name: 'Daniel Guridi', role: 'Base Editor' }, // not on the Nov 2026 org chart; added from ClickUp activity (Oil of Oregano pipeline)
    ],
  },
  {
    id: 'garlic-internal', name: 'Garlic Internal', group: 'Internal', kpi: KPI_STANDARD,
    members: [
      { id: 81411039, name: 'Kenny', role: 'Lead Editor' },
      { id: 100861480, name: 'Jerome Pardillo', role: 'Senior Editor' },
      { id: 101039297, name: 'Joanna Caoile', role: 'Senior Editor' },
      { id: 101056546, name: 'Vicky Sarza', role: 'Senior Editor' },
      { id: 101032725, name: 'Aviore Dela Cruz', role: 'Base Editor' },
      { id: 276832125, name: 'Danielle Credo', role: 'Base Editor' },
      { id: 100650808, name: 'Jhonas Dejusay', role: 'Base Editor' },
      { id: 312795014, name: 'Glen Vequizo', role: 'Base Editor' },
      { id: 312836231, name: 'Aljon Ken Postrado', role: 'Base Editor' },
      { id: 106867159, name: 'Mariela Bonayog', role: 'Base Editor' },
      { id: 106899173, name: 'Sean Raphael Gregori', role: 'Base Editor' },
      { id: 106899186, name: 'John Jerve Cenita', role: 'Base Editor' },
      { id: 100998806, name: 'Aliza Lagarde', role: 'Base Editor' },
      { id: 101079560, name: 'Angel Canoy', role: 'Base Editor' },
      { id: 101077283, name: 'Brent Tobias', role: 'Base Editor' },
      { id: 101080541, name: 'Dexter Francisco', role: 'Base Editor' },
      { id: 101079562, name: 'Lovely Gade', role: 'Base Editor' },
      { id: 101072990, name: 'Renz Ostonal', role: 'Base Editor' },
      { id: 101072991, name: 'Roy Reville', role: 'Base Editor' },
      { id: 106899184, name: 'Geniel Bryan Alburo', role: 'Base Editor' },
      { id: 100992066, name: 'Phat Le', role: 'Base Editor' },
      { id: 106875824, name: 'Elamparithi Loganathan', role: 'Base Editor' },
      { id: 101056547, name: 'Shiela Marie Canlas', role: 'Base Editor' },
      { id: 106869047, name: 'Martin Ronidel', role: 'Base Editor' },
      { id: 106870039, name: 'Jhana Red', role: 'Base Editor' },
      { id: 106899188, name: 'Abbygail Tabuso', role: 'Base Editor' },
      { id: 106899170, name: 'Jomar Estrella', role: 'Base Editor' },
      { id: 106899942, name: 'Christian Palor', role: 'Base Editor' },
    ],
  },
  {
    id: 'cin-internal', name: 'Cin Internal', group: 'Internal', kpi: KPI_STANDARD,
    members: [
      { id: 94574911, name: 'Mariel Bragado', role: 'Lead Editor' },
      { id: 101077287, name: 'Avon Mae Romero', role: 'Senior Editor' },
      { id: 106853456, name: 'James Butad', role: 'Senior Editor' },
      { id: 106887750, name: 'Allana Oray', role: 'Base Editor' },
      { id: 101039298, name: 'Jason Verceles', role: 'Base Editor' },
      { id: 106887741, name: 'Joseph Viesca', role: 'Base Editor' },
      { id: 106887743, name: 'Erika Joyce Cortez', role: 'Base Editor' },
      { id: 106887758, name: 'Mark Christian Romero', role: 'Base Editor' }, // "Christian Romero" (mark.romero@) in ClickUp
      { id: 106887744, name: 'Mary Grace Sabaybay', role: 'Base Editor' },
      { id: 106899171, name: 'Leslie Postrado', role: 'Base Editor' },
      { id: 101079564, name: 'Hazel Ruiz', role: 'Base Editor' },
      { id: 101062024, name: 'Lordave Gaite', role: 'Base Editor' },
      { id: 106886801, name: 'Jenivive Martin', role: 'Base Editor' },
      { id: 106887980, name: 'Mark Stevenson Caoile', role: 'Base Editor' },
      { id: 106888687, name: 'Ronald Rivera', role: 'Base Editor' },
      { id: 106887749, name: 'Kimberly Navales', role: 'Base Editor' },
      { id: 106899213, name: 'Wilson Sularte', role: 'Base Editor' },
      { id: 106927452, name: 'Ricthcee Erabon', role: 'Base Editor' }, // not on the Nov 2026 org chart; added from ClickUp activity (Cinnamon List)
      { id: 106927449, name: 'Ryan Biore', role: 'Base Editor' }, // not on the Nov 2026 org chart; added from ClickUp activity (Cinnamon List)
      { id: 106927450, name: 'Audrean Verr', role: 'Base Editor' }, // not on the Nov 2026 org chart; added from ClickUp activity (Cinnamon List)
      { id: 106927451, name: 'Glen Fortun', role: 'Base Editor' }, // not on the Nov 2026 org chart; added from ClickUp activity (Cinnamon List)
      { id: 106928818, name: 'Grace Vivora', role: 'Base Editor' }, // not on the Nov 2026 org chart; added from ClickUp activity (Cinnamon List)
      { id: 106928815, name: 'Millaine Reyes', role: 'Base Editor' }, // not on the Nov 2026 org chart; added from ClickUp activity (Cinnamon List)
      { id: 106928816, name: 'John Ayagan', role: 'Base Editor' }, // not on the Nov 2026 org chart; added from ClickUp activity (Cinnamon List)
    ],
  },
  {
    id: 'oregano-variations', name: 'Oregano Variations', group: 'Variations', kpi: KPI_STANDARD,
    members: [
      { id: 14710559, name: 'Abdullah Sakhi', role: 'Lead Editor' },
      { id: 101069806, name: 'Kim Estrella', role: 'Senior Editor' }, // Kim Estrella in ClickUp: Oregano work (Kim Robes is inactive)
      { id: 106875716, name: 'Abdul Rehman', role: 'Senior Editor' }, // abdul.rehman@ in ClickUp: the one working in Oregano Variation
      { id: 50112612, name: 'Fazal', role: 'Base Editor' },
      { id: 101097537, name: 'Safdar', role: 'Base Editor' }, // "Muhammad Safdar" in ClickUp
      { id: 106839172, name: 'Arslan Shaukat', role: 'Base Editor' }, // "Arslan" on the org chart; works in Oregano Variation
      { id: 106859554, name: 'Ayyaz Bin Mumtaz', role: 'Base Editor' }, // "Ayyaz" on the org chart; works in Oregano Variation
      { id: 106916467, name: 'Angelo Ocampo', role: 'Base Editor' }, // not on the Nov 2026 org chart; added from ClickUp activity (Oregano Variation)
    ],
  },
  {
    id: 'garlic-variations', name: 'Garlic Variations', group: 'Variations', kpi: KPI_STANDARD,
    members: [
      { id: 81411039, name: 'Kenny', role: 'Lead Editor' },
      { id: 89429223, name: 'Rovan Legaspi', role: 'Senior Editor' },
      { id: 106899169, name: 'CJ Bugayon', role: 'Base Editor' },
      { id: 106899945, name: 'Mark Quintana', role: 'Base Editor' },
      { id: 106850252, name: 'Ezekiel Matias', role: 'Base Editor' },
      { id: 106850022, name: 'John Henry P. Francisco', role: 'Base Editor' },
      { id: 106850253, name: 'Joyce Ann Santos', role: 'Base Editor' },
      { id: 101062025, name: 'Keith Yagyagan', role: 'Base Editor' },
      { id: 101080542, name: 'Uriel Segura', role: 'Base Editor' },
    ],
  },
  {
    id: 'cin-variations', name: 'Cin Variations', group: 'Variations', kpi: KPI_STANDARD,
    members: [
      { id: 94574911, name: 'Mariel Bragado', role: 'Lead Editor' },
      { id: 101039298, name: 'Jason Verceles', role: 'Base Editor' },
      { id: 106887758, name: 'Mark Romero', role: 'Base Editor' },
      { id: 106886801, name: 'Jenivive Martin', role: 'Base Editor' },
    ],
  },
  {
    id: 'oregano-agency', name: 'Oregano Agency', group: 'Agency', kpi: KPI_STANDARD,
    members: [
      { id: 89314312, name: 'Rehan', role: 'Lead Editor' }, // has older tasks in our ClickUp; current agency work is in the agency workspace
      { id: 106853461, name: 'DJ Bunda', role: 'Senior Editor' },
      { id: 106865296, name: 'Muhammad Khan', role: 'Senior Editor' },
      { id: null, name: 'Cesar Aviles', role: 'Base Editor' },
      { id: 106853458, name: 'Huzaifa', role: 'Base Editor' },
      { id: 118406792, name: 'Rafay Shaikh', role: 'Base Editor' },
      { id: 106859607, name: 'Adekanmbi Israel Oluwatomiwa', role: 'Base Editor' },
      { id: 124268747, name: 'Safeer', role: 'Base Editor' },
      { id: 101079830, name: 'Divine', role: 'Base Editor' },
      { id: 106857508, name: 'Hammad', role: 'Base Editor' },
      { id: 124396346, name: 'Robert Phinex', role: 'Base Editor' },
      { id: 118467310, name: 'Devinda Mahasen', role: 'Base Editor' },
      { id: 106850019, name: 'Javeria Rafiq', role: 'Base Editor' },
      { id: 106850009, name: 'Jediea Leynes', role: 'Base Editor' },
      { id: 118463172, name: 'Ahmed Umaru', role: 'Base Editor' },
      { id: 118406791, name: 'Adaoma Ikeobi', role: 'Base Editor' },
      { id: 118463840, name: 'Salah Grini', role: 'Base Editor' },
      { id: 118467312, name: 'Muhammad Bilal', role: 'Base Editor' },
      { id: 124396344, name: 'Daniel Ferrero', role: 'Base Editor' },
    ],
  },
  {
    id: 'garlic-agency', name: 'Garlic Agency', group: 'Agency', kpi: KPI_STANDARD,
    members: [
      { id: 89314312, name: 'Rehan', role: 'Lead Editor' }, // has older tasks in our ClickUp; current agency work is in the agency workspace
      { id: 106853455, name: 'Ahmad Muhmmad Khabir', role: 'Senior Editor' },
      { id: 101096565, name: 'Ibbad', role: 'Senior Editor' }, // has older tasks in our ClickUp; current agency work is in the agency workspace
      { id: 106861351, name: 'Mohtashim', role: 'Base Editor' },
      { id: 106864211, name: 'Kevin Puuhlet', role: 'Base Editor' },
      { id: 106865210, name: 'Ramsha Zia', role: 'Base Editor' },
      { id: 106850013, name: 'Muhammad Rajal', role: 'Base Editor' },
      { id: 118443343, name: 'Danielle Anne M. Aserdano', role: 'Base Editor' },
      { id: 124235756, name: 'Maven Divine', role: 'Base Editor' },
      { id: 124396342, name: 'Ali Raza 2', role: 'Base Editor' },
      { id: 308472956, name: 'Saifullah Shaikh', role: 'Base Editor' },
      { id: null, name: 'Maheen Safia', role: 'Base Editor' },
      { id: 124239793, name: 'Owais Ahmed', role: 'Base Editor' },
      { id: 106859593, name: 'Miloua Mohammed', role: 'Base Editor' },
      { id: 124306495, name: 'Ali Raza', role: 'Base Editor' },
      { id: 106850006, name: 'Analyn Oriel', role: 'Base Editor' },
      { id: 124396345, name: 'Hassan Murad', role: 'Base Editor' },
      { id: 124396343, name: 'Muzamil Raza', role: 'Base Editor' },
    ],
  },
  {
    id: 'cin-agency', name: 'Cin Agency', group: 'Agency', kpi: KPI_STANDARD,
    members: [
      { id: 112426642, name: 'Arifeen Ahmad', role: 'Lead Editor' }, // has older tasks in our ClickUp; current agency work is in the agency workspace
      { id: 106854520, name: 'Saharish Saleem', role: 'Senior Editor' }, // has older tasks in our ClickUp; current agency work is in the agency workspace
      { id: 118443565, name: 'Sabina K', role: 'Senior Editor' },
      { id: 118443309, name: 'Andre Tan', role: 'Base Editor' },
      { id: 106892224, name: 'John Lee Capio Corpuz', role: 'Base Editor' },
      { id: 118443566, name: 'Sana Tasleem', role: 'Base Editor' },
      { id: 106856548, name: 'Tayyab Ejaz', role: 'Base Editor' }, // has older tasks in our ClickUp; current agency work is in the agency workspace
      { id: 118443337, name: 'Zeeshan Waheed', role: 'Base Editor' },
      { id: 106868917, name: 'Ronalyn Malemit', role: 'Base Editor' }, // has older tasks in our ClickUp; current agency work is in the agency workspace
      { id: 106870043, name: 'Natasha Brown', role: 'Base Editor' }, // has older tasks in our ClickUp; current agency work is in the agency workspace
      { id: 106850018, name: 'Shaina Gavino', role: 'Base Editor' },
      { id: 101077289, name: 'Jullie Ortega-Postrado', role: 'Base Editor' }, // has older tasks in our ClickUp; current agency work is in the agency workspace
      { id: 106867156, name: 'Elseiyah Navales', role: 'Base Editor' }, // has older tasks in our ClickUp; current agency work is in the agency workspace
      { id: 124294173, name: 'Muhammad Ali', role: 'Base Editor' },
      { id: 106916411, name: 'Paras Bhatia', role: 'Base Editor' },
      { id: 106919236, name: 'Ayyaz Mallah', role: 'Base Editor' },
      { id: 106919232, name: 'Akanksha Thakur', role: 'Base Editor' },
      { id: 124355135, name: 'Muhammad Yasir', role: 'Base Editor' },
      { id: 124396266, name: 'Adarsh Singh', role: 'Base Editor' },
    ],
  },
];

// ------------------------------------------------------------------ hierarchy + KPI rules

export type Tier = 'lead' | 'senior' | 'editor';
/** From the org-chart role: "Lead Editor", "Editing Lead – Resizing" → lead; "Senior Editor", "Sr. Editor" → senior */
export function tierOf(role: string): Tier {
  if (/\blead\b/i.test(role)) return 'lead';
  if (/\b(senior|sr\.?)\b/i.test(role)) return 'senior';
  return 'editor';
}
export const TIER_ORDER: Record<Tier, number> = { lead: 0, senior: 1, editor: 2 };

/**
 * Edits a member is expected to finish on one day (YYYY-MM-DD), by tier and date (Farwa / Aiman, Nov 2026):
 * - Leads: 0 (they manage the team; their own edits still count in totals and on the leaderboard).
 * - October 2026: every team except the Resizing group 3 a week (0.6 a workday).
 * - Otherwise the team KPI (Resizing 2/day, others 1/day). Seniors: 1–2 a day; until told otherwise the same as
 *   their team's editors (SENIOR_PER_DAY overrides, e.g. 2).
 */
const SENIOR_PER_DAY = Number(process.env.SENIOR_PER_DAY) || null;
export function perDayFor(team: Team, role: string, day: string): number {
  const tier = tierOf(role);
  if (tier === 'lead') return 0;
  if (day.startsWith('2026-10') && team.group !== 'Resizing') return 3 / 5;
  if (tier === 'senior' && SENIOR_PER_DAY) return SENIOR_PER_DAY;
  return team.kpi.perDay;
}

/** The KPI table shown in the UI (KPI rules panel) */
export const KPI_RULES = [
  { period: 'From Nov 1, 2026', rows: [
    { who: 'Editor · Resizing', kpi: '2 a day · 14 a week' },
    { who: 'Editor · every other team', kpi: '1 a day · 5 a week' },
    { who: 'Senior', kpi: SENIOR_PER_DAY ? `${SENIOR_PER_DAY} a day` : '1–2 a day (team KPI)' },
    { who: 'Lead', kpi: '0 (manages the team)' },
  ] },
  { period: 'October 2026', rows: [
    { who: 'Resizing', kpi: '2 a day · 14 a week' },
    { who: 'Every other team', kpi: '3 a week' },
  ] },
];

// ------------------------------------------------------------------ boards: which team a ClickUp task belongs to

/** Resilia ClickUp list -> team id (live pipelines and their archives). Lists not here have no board. */
const LIST_BOARD: Record<string, string> = {
  '901614785376': 'oregano-internal', '901611135664': 'oregano-internal', '901614224080': 'oregano-internal',
  '901615209472': 'oregano-internal', '1300340000012950': 'oregano-internal',
  '901614380046': 'garlic-internal', '901615213899': 'garlic-internal', '1300340000012951': 'garlic-internal',
  '901616741550': 'cin-internal', '1300340000012952': 'cin-internal',
  '1300340000000866': 'oregano-variations', '1300340000001523': 'garlic-variations', '1300340000009738': 'cin-variations',
  '901615541251': 'iterations',
  '1300340000008474': 'resizing', '1300340000008475': 'resizing', '1300340000008385': 'resizing',
  '1300340000009707': 'resizing', '1300340000009691': 'resizing', '1300340000009709': 'resizing',
};

/** Product (SKU) text -> oregano | garlic | cin */
export function productKey(product: string | null | undefined, fallback = ''): 'oregano' | 'garlic' | 'cin' | null {
  const s = `${product ?? ''} ${fallback}`.toLowerCase();
  if (/oregano|blackseed|\boo\b/.test(s)) return 'oregano';
  if (/garlic|\baog\b/.test(s)) return 'garlic';
  if (/cinnamon|\bcin\b/.test(s)) return 'cin';
  return null;
}

export type TaskPlace = { listId: string | null; workspace?: string | null; product?: string | null; name?: string | null };
/** The team board a task belongs to: its list in Resilia's ClickUp, or "<product>-agency" for agency tasks */
export function boardOf(t: TaskPlace): string | null {
  if (t.workspace === 'agency') {
    const p = productKey(t.product, t.name?.match(/^(OO|AOG|CIN)-/i)?.[1] ?? '');
    return p ? `${p}-agency` : null;
  }
  return t.listId ? LIST_BOARD[t.listId] ?? null : null;
}

/** Teams each member key is on, in TEAMS order (the first is their home team) */
export const TEAMS_OF: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const t of TEAMS) for (const mm of t.members) m.set(memberKey(mm), [...(m.get(memberKey(mm)) ?? []), t.id]);
  return m;
})();

/**
 * Does a task on `board` count for this member on team `teamId`? People on one team: always. People on several
 * teams: on the team whose board the task came from; tasks from no board (or a board they're not on) count on their
 * home team (the first one).
 */
export function countsOnTeam(key: string, teamId: string, board: string | null): boolean {
  const teams = TEAMS_OF.get(key) ?? [teamId];
  if (teams.length <= 1) return true;
  if (board && teams.includes(board)) return board === teamId;
  return teams[0] === teamId;
}

// ------------------------------------------------------------------ reporting lines (org chart, Direct Manager column)

/**
 * Who reports to whom, per team, by roster name (Full Roster sheet, Nov 2026). People whose manager is "TBD – assign
 * senior editor" are not listed; for bonus "Pod quality" a Senior without direct reports covers the unassigned Base
 * Editors on their team.
 */
const REPORTS: Record<string, Record<string, string[]>> = {
  resizing: {
    'Michael Roque': ['Usama Mir', 'Aqib Shakeel', 'Dustin Bryan', 'Armand Lladones', 'Lucylen (Lucy) Pagado', 'Jerry Emmanuel', 'Tope Ojomo', 'Neil Dave', 'Jasmin Marinay', 'Lucky Jake Tapayan', 'Clariz Barrera'],
    'Ayyaz Sohail': ['Haseeb Choudhary', 'Adilbek Sultanov', 'Saif Adam', 'Jay-el Tobias', 'Gagandeep Kumar', 'Vansh Ahluwalia', 'Jude Elega', 'Mian Muhammad Nasir', 'Omer Aayan'],
    'Cristian Jay Reyes': ['Zamad Khan', 'Thai Anh Tu', 'Muhammad Bilal', 'Yahya Syed', 'Kiran Akash', 'Sidra Nazish', 'Amna Tanveer', 'Arslan Sahabrso', 'Rehman Khan'],
  },
  iterations: { 'Damia Tasleem': ['*'] },
  'garlic-variations': { 'Rovan Legaspi': ['CJ Bugayon', 'Mark Quintana', 'Ezekiel Matias', 'John Henry P. Francisco', 'Joyce Ann Santos', 'Keith Yagyagan', 'Uriel Segura'] },
  'cin-variations': { 'Mariel Bragado': ['Jason Verceles', 'Mark Romero', 'Jenivive Martin'] },
  'oregano-agency': {
    'DJ Bunda': ['Cesar Aviles', 'Huzaifa', 'Rafay Shaikh', 'Adekanmbi Israel Oluwatomiwa', 'Safeer', 'Divine', 'Hammad', 'Robert Phinex'],
    'Muhammad Khan': ['Devinda Mahasen', 'Javeria Rafiq', 'Jediea Leynes', 'Ahmed Umaru', 'Adaoma Ikeobi', 'Salah Grini', 'Muhammad Bilal', 'Daniel Ferrero'],
  },
  'garlic-agency': {
    'Ahmad Muhmmad Khabir': ['Mohtashim', 'Kevin Puuhlet', 'Ramsha Zia', 'Muhammad Rajal', 'Danielle Anne M. Aserdano', 'Maven Divine', 'Ali Raza 2'],
    'Ibbad': ['Saifullah Shaikh', 'Maheen Safia', 'Owais Ahmed', 'Miloua Mohammed', 'Ali Raza', 'Analyn Oriel', 'Hassan Murad', 'Muzamil Raza'],
  },
};

/** Member keys reporting directly to each manager (by manager member key), across teams */
export const DIRECT_REPORTS: Map<string, Set<string>> = (() => {
  const out = new Map<string, Set<string>>();
  for (const [teamId, managers] of Object.entries(REPORTS)) {
    const team = TEAMS.find(t => t.id === teamId);
    if (!team) continue;
    const byName = (n: string) => team.members.find(m => m.name.toLowerCase() === n.toLowerCase());
    for (const [mgrName, names] of Object.entries(managers)) {
      const mgr = byName(mgrName);
      if (!mgr) continue;
      const set = out.get(memberKey(mgr)) ?? new Set<string>();
      const reports = names[0] === '*' ? team.members.filter(m => m !== mgr) : names.map(byName).filter((m): m is TeamMember => !!m);
      for (const r of reports) set.add(memberKey(r));
      out.set(memberKey(mgr), set);
    }
  }
  return out;
})();
/** Everyone on a team who has a listed manager there */
export const HAS_MANAGER: Set<string> = new Set([...DIRECT_REPORTS.values()].flatMap(s => [...s]));
