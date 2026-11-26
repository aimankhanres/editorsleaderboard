/**
 * Strategist pods (Farwa / Aiman, Nov 2026). Ad names carry the pod, e.g. "AOG-101616_2026-10-05_Pod 111_TOF_…":
 * that pod's strategist(s) get the ad's spend. A shared pod (two people) splits it evenly.
 * ClickUp "Strategist" users are matched to these people by a one-way hash of their email (no addresses in the repo).
 * Not people: Pod999 (Auto Bot); the iOO1 / rOO1 iteration codes are not pods.
 */
export type PodGroup = 'Internal' | 'Agency' | 'vibe TV';
/** `emails` holds emailHash() of each address (the repo is public, so no addresses are stored) */
export type Strategist = { key: string; name: string; emails: string[]; group: PodGroup; active: boolean };

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const P = (name: string, emails: string[], group: PodGroup = 'Internal', active = true): Strategist =>
  ({ key: `p:${slug(name)}`, name, emails, group, active });

export const PEOPLE = {
  bilal: P('Bilal Kone', ['e47e7603f9c1b5a7']),
  clayd: P('Clayd', ['7d9e500c66faf3e1']),
  david: P('David Seyffer', ['435607a1956f8097']),
  farwa: P('Farwa Javeed', ['d489c20d0a7386c6']),
  ezra: P('Ezra Sivan', ['b76ee06a2615faec']),
  jamil: P('Jamil Rashid', ['8c768cec874211f9']),
  julv: P('Jul V', ['169fba54da73a93c']),
  liran: P('Liran Ravid', ['8a2c24141ae0a928']),
  lucas: P('Lucas Correia', ['e7240120f0e2f3b5']),
  marco: P('Marco Fernandez', ['fcb5008e243fe198']),
  mariel: P('Mariel Bragado', ['b7979f3012fb77c1']),
  martin: P('Martin Tappen', ['ef4aad6e1e0e3efd']),
  mia: P('Mias Creatives', ['e8bc1f1b88f2dc39']),
  neil: P('Neil Swetam', ['9cc75902672174eb']),
  oliver: P('Oliver Hybholt', ['09ef54582cb5ecce']),
  will: P('Will Y', ['6e0e69ec18249463']),
  zayd: P('Zayd', ['27fe7fe6a08a2332']),
  damia: P('Damia Tasleem', ['a14425e75860efd7']),
  lorena: P('Lorena', ['b78114d6f98ba09e']),
  ilan: P('Ilan', ['e0526591f844d96b', '31ea73c7109c1873']), // "Elon Moose" on the agency list, Pod 53 too
  harsh: P('Harsh', ['df97e293b68611ae']),
  abdullah: P('Abdullah Sakhi', ['9b5e5ebb38dcf331']),
  brett: P('Brett Wall', ['4a1a810841ffda63']),
  kenny: P('Kenny McKray', ['0114cce797807ea1']),
  edil: P('Edil', ['5faf1f637ed18d83'], 'vibe TV'),
  paolo: P('Paolo Louis', ['2a1a2f5453ea2605']),
  aamnah: P('Aamnah Mir', ['8fe8fea45315d9dd', '104d336888e2e68e']),
  hamza: P('Hamza Azmil', ['c376eebc5aebc77b'], 'vibe TV'),
  // Agency strategists
  stevan: P('Stevan Blagojević', ['5f9daf90e9e729b3'], 'Agency'),
  peter: P('Peter Nguyen', ['315c96f8c66c4b79'], 'Agency', false),
  shourya: P('Shourya Roy', ['7252a2a1a64b9e10'], 'Agency', false),
  karolis: P('Karolis Masevicius', ['b1b8c93de41bc6e3'], 'Agency'),
  fotis: P('Fotis Chatzinicolaou', ['96d5e6d5186bb17f'], 'Agency'),
  andrea: P('Andrea Undecimo', ['42f728914eba1142'], 'Agency'),
  eduardo: P('Eduardo Seco', ['f8d0086c57907570'], 'Agency'),
  mario: P('Mario Negulescu', ['b8b9837d8b8b3fb9'], 'Agency', false),
  nick: P('Nick Staab', ['ac4ade6d39091d7c'], 'Agency', false),
  nojus: P('Nojus Dovydenas', ['cfb9e5f5a35fb53e'], 'Agency'),
  victor: P('Victor Agapit', ['7518f0b5c93fd900'], 'Agency', false),
  henry: P('Henry Nguyen', ['492eb60548c19838'], 'Agency'),
  borna: P('Borna Draganic', ['0b2f04acc9750f6e'], 'Agency'),
  arthur: P('Arthur Wanzeler', ['f9891ad2bf964b10'], 'Agency', false),
  rhed: P('Rhed Brandon', ['3f755ac214609c96'], 'Agency', false),
  sean: P('Sean Robey', ['9dd8d548dea3d2f5'], 'Agency'),
  yusuf: P('Yusuf Kapoor', ['dd400d98a7e0c920'], 'Agency'),
  lucia: P('Lucia Garcia', ['41b787242ffcc878'], 'Agency'),
  kyle: P('Kyle Nguyen', ['e3d4376e11c86553'], 'Agency'),
  matej: P('Matej Dolenec', ['4e102a9030d67caa'], 'Agency'),
  elissa: P('Elissa Jabbour', ['0050be6e4136e051'], 'Agency'),
  alextran: P('Alex Tran', ['bb8ced567efb5b17'], 'Agency'),
  eman: P('Eman Akbarpour', ['b1e83c8d065ded0e'], 'Agency'),
  jollie: P('Jollie Hong', ['5ef71c7f81dbdea3'], 'Agency'),
  aaron: P('Aaron Tan', ['b1dd58e3675983ef'], 'Agency'),
  jayden: P('Jayden Tong', ['3cda6c03898afe15'], 'Agency'),
  alexd: P('Alex Dankoales', ['c88a7c5647b988b9'], 'Agency'),
  mei: P('Mei Zhu', ['4d664f3d811fcec0'], 'Agency'),
  cambell: P('Cambell Dodson', ['15d0564253910ab5'], 'Agency'),
  harry: P('Harry Randall', ['857ff96c9c2cc9b3'], 'Agency'),
  andrew: P('Andrew Ranzinger', ['c01ef894bd4b7b3a'], 'Agency'),
  hakim: P('Hakim Maghnem', ['ed06f5013c3f8e14'], 'Agency'),
  drew: P('Drew Khola', ['1e39fec27cb59b40'], 'Agency'),
  anthony: P('Anthony Carrasquillo', ['3c0a7f3e4beb5fb6'], 'Agency'),
  xanth: P('Xanth Vigil', ['1b5d115b5d8d203a'], 'Agency'),
  martinn: P('Martin Nguyen', ['5a4f998b211018d1'], 'Agency'),
  keyan: P('Keyan Faizil', ['a2297f004a9ee12d'], 'Agency'),
  karen: P('Karen Hardwick', ['1c0189401f9836f4', '0f8d056db8d3f013'], 'Agency'),
} satisfies Record<string, Strategist>;

const S = PEOPLE;
/** Pod number -> strategist(s) */
export const PODS: Record<number, Strategist[]> = {
  6: [S.bilal], 7: [S.clayd], 9: [S.david], 10: [S.david, S.farwa], 13: [S.ezra], 20: [S.jamil], 23: [S.julv],
  25: [S.liran], 26: [S.liran, S.farwa], 27: [S.lucas], 28: [S.marco], 29: [S.mariel, S.martin], 30: [S.martin],
  31: [S.mia], 32: [S.mia, S.ezra], 33: [S.neil], 35: [S.oliver], 45: [S.will], 46: [S.zayd], 49: [S.farwa],
  50: [S.farwa, S.damia], 51: [S.farwa, S.martin], 52: [S.lorena], 53: [S.ilan], 54: [S.harsh], 55: [S.zayd, S.abdullah],
  56: [S.jamil, S.zayd], 57: [S.brett], 58: [S.damia], 59: [S.david, S.zayd], 60: [S.abdullah], 61: [S.zayd, S.kenny],
  62: [S.kenny], 63: [S.zayd, S.martin], 64: [S.will, S.martin], 65: [S.david], 66: [S.farwa, S.kenny],
  67: [S.farwa, S.abdullah], 68: [S.farwa, S.zayd], 69: [S.edil], 70: [S.paolo], 71: [S.harsh, S.aamnah], 72: [S.mariel],
  73: [S.hamza], 9999: [S.aamnah], // Pod9999 = Auto Bot + Aamnah: the bot is not a person
  101: [S.stevan], 102: [S.brett], 103: [S.peter], 104: [S.shourya], 105: [S.karolis], 106: [S.fotis], 107: [S.andrea],
  108: [S.eduardo], 109: [S.mario], 110: [S.nick], 111: [S.nojus], 112: [S.victor], 113: [S.henry], 114: [S.borna],
  115: [S.arthur], 116: [S.rhed], 117: [S.sean], 118: [S.yusuf], 119: [S.lucia], 120: [S.kyle], 121: [S.matej],
  122: [S.elissa], 123: [S.alextran], 124: [S.eman], 125: [S.jollie], 126: [S.aaron], 127: [S.jayden], 128: [S.alexd],
  129: [S.mei], 130: [S.cambell], 131: [S.harry], 132: [S.andrew], 133: [S.hakim], 134: [S.drew], 135: [S.anthony],
  136: [S.xanth], 137: [S.martinn], 138: [S.keyan], 998: [S.karen],
};

/** Pod number written in an ad name: "Pod 111", "Pod111", "pod56", "Podd70", "POD-35". First one wins. */
export function podOf(adName: string): number | null {
  const m = adName.match(/(?:^|[^a-z])podd?\s*[-_#]?\s*(\d{1,4})(?!\d)/i);
  return m ? Number(m[1]) : null;
}

/** Pod strategists for an ad name, or [] (unknown pod, Pod999 bot, or no pod) */
export const podStrategists = (adName: string): Strategist[] => {
  const n = podOf(adName);
  return n != null ? PODS[n] ?? [] : [];
};

/** First 16 hex characters of SHA-256 of the lowercased email (matches the hashes above) */
export async function emailHash(email: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
}

/** Email hash -> pod person */
export const PERSON_BY_EMAIL: Map<string, Strategist> = new Map(
  Object.values(PEOPLE).flatMap(p => p.emails.map(e => [e, p] as [string, Strategist])),
);
