/**
 * The editors shown on the dashboard, one board per team. Only these people appear.
 * `id` is the ClickUp user id (the app keys editors as `u:<id>`), so name changes in ClickUp don't matter.
 * To add or move someone: add a line here with their ClickUp user id (Workspace settings → People),
 * commit, and push.
 */
export type TeamMember = { id: number; name: string; role: string };
export type Team = { id: string; name: string; members: TeamMember[] };

const RESIZE = 'Video Editor – Resizing';
const GOOGLE = 'Video Editor – Google';

export const TEAMS: Team[] = [
  {
    id: 'resizing',
    name: 'Resizing',
    members: [
      { id: 106853412, name: 'Michael Roque', role: 'Editing Lead – Resizing' },
      { id: 106853408, name: 'Cristian Jay Reyes', role: 'Editing Lead – Resizing' },
      { id: 106886777, name: 'Ayyaz Sohail', role: 'Sr. Editor' },
      { id: 106853409, name: 'Clariz Barrera', role: 'Sr. Editor' },
      { id: 100998805, name: 'Usama Mir', role: RESIZE },
      { id: 106853413, name: 'Aqib Shakeel', role: RESIZE },
      { id: 106853410, name: 'Dustin Bryan', role: RESIZE },
      { id: 101080547, name: 'Armand Lladones', role: RESIZE },
      { id: 101069834, name: 'Lucylen (Lucy) Pagado', role: RESIZE },
      { id: 101095615, name: 'Jerry Emmanuel', role: RESIZE },
      { id: 101097538, name: 'Tope Ojomo', role: RESIZE },
      { id: 106838108, name: 'Neil Dave', role: RESIZE },
      { id: 106842654, name: 'Jasmin Marinay', role: RESIZE },
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
    ],
  },
  {
    id: 'iterations',
    name: 'Iterations',
    members: [
      { id: 106853401, name: 'Damia Tasleem', role: GOOGLE },
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
    ],
  },
  {
    // Same people also appear on the Resizing board; same attribution (all spend credited to them in ClickUp)
    id: 'rips',
    name: 'Rips',
    members: [
      { id: 106853409, name: 'Clariz Barrera', role: RESIZE },
      { id: 106886777, name: 'Ayyaz Sohail', role: 'Sr. Editor' },
      { id: 106853408, name: 'Cristian Jay Reyes', role: 'Editing Lead – Resizing' },
      { id: 106842654, name: 'Jasmin Marinay', role: RESIZE },
      { id: 101069834, name: 'Lucylen (Lucy) Pagado', role: RESIZE },
    ],
  },
];
