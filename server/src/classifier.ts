// Classification engine — same rules as the client app (Phase 1+2), source of truth server-side.
const RULES: Array<[RegExp, string]> = [
 [/PAYROLL|DIRECT DEP|IL STATE UNIV ACH|INTEREST PAID|IRS TREAS|TAX REF|KASASA ATM REFUND|ACCTVERIFY 840|VSA RTN/, 'Income & Refunds'],
 [/PAY OFF LOAN|TRANSFER TO LOANS/, 'Loan Payments'],
 [/DISCOVER E-PAYMENT|CAPITAL ONE/, 'Credit Card Payments'],
 [/FID BKG|NATL FIN SVC|TRANSFER TO SAVER|ROBINHOOD/, 'Savings & Investments'],
 [/JUD ?MNTGMY COURT/, 'Legal & Court'],
 [/STUDENT APARTMEN|APARTMENTS? RENT|RENT PMT|\bLEASING\b|PROPERTY MGMT/, 'Rent & Housing'],
 [/PROG UNIVERSAL INS|PROGRESSIVE INSURANCE|GEICO|STATE FARM|ALLSTATE/, 'Insurance'],
 [/XFINITY|COMCAST|VERIZON|T-MOBILE|AT&T|SPECTRUM|ELECTRIC UTILIT|WATER UTILIT|GAS UTILIT|UTILITY|UTILITIES/, 'Utilities & Bills'],
 [/LINCOLN LAND|COLLEGE TRANSCRIPT|QUIZLET|COMPTIA|ISU PURCHASE|ISU ST ACC|ISU ONLINE|ISU PARKING|ILLINOIS ?STATE ?UNIVERSI|JONES BARTLETT|CENGAGE|PEARSON|MCGRAW-HILL|WW NORTON|COURSERA|ALAMO II BKST/, 'Education'],
 [/HRB ONLINE TAX/, 'Taxes'],
 [/SPEEDY LUBE|O REILLY|CAR WASH|\bUBER\b|\bLYFT\b|JIFFY LUBE|VALVOLINE|AUTOZONE/, 'Auto'],
 [/CRUNCH|WORKOUT COMPANY|G\.Y\.M\.|PLANET FITNESS|LA FITNESS|ANYTIME FITNESS|YMCA/, 'Gym & Fitness'],
 [/GAME PASS|EB CHICAGO|EB TAKE ME OUT|SQ CAGES|RIOT AN|STUBHUB|GRIFFIN MUS|NAVY PIER|MICROSOFT|XBOX/, 'Entertainment'],
 [/ATM SERVICE CHARGE|PHONE TRANSFER FEE|TN SERV FEE|FEDEX/, 'Fees'],
 [/\bWDL\b/, 'Cash Withdrawals'],
 [/IMPULSE VAPE|SMOKERS DEN/, 'Vape & Tobacco'],
 [/SUNNY AND REDS|BLUE BELL CLUB|THE VAULT|SIX STRINGS|THE ZONE 24|WESTERN TAP|LIL BEAVER|PUB 2|707 LIQUORS|LUCKY SEVENS/, 'Bars & Nightlife'],
 [/VITAMIN SHOPPE|CVS PHARMACY|SAV-MOR|SPRINGFIELD CLINIC|DENTAL|AMERICA S BEST/, 'Health & Pharmacy'],
 [/STEAM|APPLE|CLAUDE|ANTHROPIC|OPENAI|CHATGPT|LINKEDIN|RESUME\.CO|CCLEANER|AMAZON PRIME|NETFLIX|SPOTIFY|HULU|DISNEY PLUS|DISNEY\+|YOUTUBE PREM|PARAMOUNT\+/, 'Subscriptions & Digital'],
 [/MCDONALDS|DAVES HOT CHICKEN|TACO BELL|DAIRY QUEEN|COLDSTONE|DENNYS|DADDIOS|POTRILLOS|MCALISTER|DOMINO|PANDA EXPRESS|FLINGERS|FAT JACKS|FARMERS STATION|PEGGY KINNANES|HOME AWAY FROM HOM|VINES ON CLARK|SHAKE SHACK|MCDONALD|HAWG DINER|SEOUL MAMA|CHIPOTLE|RAISING CANES|JIMMY JOHNS|TRES COMPADRES|ARV BURGERS|HEATERZ|DOORDASH|CANTEEN VENDING|\bTST\b|\bSQ\b|STARBUCKS|SUBWAY|WENDY|BURGER KING|\bKFC\b|POPEYES|PIZZA HUT|PAPA JOHN|OLIVE GARDEN|APPLEBEE|IHOP|DUNKIN/, 'Dining & Fast Food'],
 [/CASEYS|FAST STOP|AYERCO|ARLINGTON MART|CIRCLE K|PHILLIPS 66|AMITY FOOD MART|SHELL OIL|\bSHELL\b|EXXON|CHEVRON|\bBP\b|MARATHON PETRO|SPEEDWAY/, 'Gas & Convenience'],
 [/ALDI|JEWEL OSCO|SCHNUCKS|WAL-MART|WM SUPERCENTER|DOLLAR.GENERAL|DOLLAR TREE|KROGER|\bTARGET\b|COSTCO|WHOLE FOODS|TRADER JOE|PUBLIX|SAFEWAY|MEIJER|FOOD LION/, 'Groceries & Household'],
 [/ROSS STORES|TIKTOK SHOP|AMAZON|META STORE|TJMAXX|ALIEXPRESS|NORMAL GADGETS|THE ITEM SHOP|ADVANCED COMPUTING|HP\.COM|BEST BUY/, 'Shopping'],
 [/SPORT CLIPS|CSC SERVICEWORK/, 'Personal Care'],
 [/VENMO|CASH APP|PHTFRDDA|PHONE TFR/, 'P2P & Transfers']
];
export const ALL_CATS = ['Rent & Housing','Loan Payments','P2P & Transfers','Education','Credit Card Payments','Shopping','Groceries & Household','Legal & Court','Dining & Fast Food','Insurance','Utilities & Bills','Gas & Convenience','Entertainment','Savings & Investments','Subscriptions & Digital','Health & Pharmacy','Gym & Fitness','Auto','Cash Withdrawals','Vape & Tobacco','Bars & Nightlife','Personal Care','Fees','Taxes','Other','Income & Refunds'];

export function classify(desc: string, amt: number): string {
  // LOG-2 (intentional simplification): all inflows — payroll, interest, refunds,
  // merchant credits — land in 'Income & Refunds'. Splitting refunds back into
  // their spending category is a Phase-6 enhancement (needs original-purchase
  // matching to avoid double-counting income).
  if (amt > 0) return 'Income & Refunds';
  const u = String(desc).toUpperCase();
  for (const [re, cat] of RULES) if (re.test(u)) return cat;
  return 'Other';
}

const MERCHANTS = ['CASEYS','MCDONALD','DOLLAR GENERAL','VITAMIN SHOPPE','FAST STOP','WAL-MART','WM SUPERCENTER','ALDI','JEWEL OSCO','SCHNUCKS','KROGER','DOLLAR TREE','TACO BELL','DAIRY QUEEN','COLDSTONE','DENNYS','DADDIOS','POTRILLOS','MCALISTER','DOMINO','PANDA EXPRESS','FLINGERS','FAT JACKS','SHAKE SHACK','CHIPOTLE','RAISING CANES','JIMMY JOHNS','DAVES HOT CHICKEN','TIKTOK SHOP','ROSS STORES','AMAZON','META STORE','TJMAXX','HP.COM','APPLE','CLAUDE','ANTHROPIC','OPENAI','QUIZLET','STEAM','RIOT','MICROSOFT','XBOX','STUBHUB','CIRCLE K','PHILLIPS 66','CVS','SAV-MOR','SPORT CLIPS','CRUNCH','IMPULSE VAPE','SMOKERS DEN','ROBINHOOD','CASH APP','VENMO','DISCOVER','CAPITAL ONE','FID BKG','PROG','STUDENT APARTMEN','NETFLIX','SPOTIFY','STARBUCKS','SHELL','TARGET','COSTCO','PLANET FITNESS','GEICO','XFINITY','VERIZON','UBER','LYFT','WILLOW CREEK','BEST BUY','WENDYS','SUBWAY','ACME LOGISTICS'];
const NICE: Record<string, string> = {'MCDONALD':"McDonald's",'CASEYS':"Casey's",'WAL-MART':'Walmart','WM SUPERCENTER':'Walmart','PROG':'Progressive Insurance','STUDENT APARTMEN':'Student Apartments (Rent)','FID BKG':'Fidelity','HP.COM':'HP Store','SAV-MOR':'Sav-Mor Pharmacy','RIOT':'Riot Games','WILLOW CREEK':'Willow Creek Apts (Rent)','ACME LOGISTICS':'Acme Logistics (Payroll)','SHELL':'Shell','XFINITY':'Xfinity','VERIZON':'Verizon','WENDYS':"Wendy's"};

export function cleanDesc(desc: string): string {
  let d = String(desc).replace(/^4274 (VSA PUR|PUR|VSA RECUR|RECUR|VSA RTN|WDL|PMT DB|ATM)\s*/, '').trim();
  return d.replace(/^VSA PUR\s*/, '');
}
export function merchant(desc: string): string {
  const u = String(desc).toUpperCase();
  for (const m of MERCHANTS) {
    if (u.includes(m)) return NICE[m] || m.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
  }
  let d = cleanDesc(desc).replace(/^(TST|SQ)\s+/, '').replace(/\d{3}-\d{3,}.*/, '').replace(/\s+(IL|CA|WA|NY|NC|OH|VA|MO|TX|FL)$/, '').trim();
  const words = d.split(/\s+/).slice(0, 3);
  if (!words.length || !words[0]) return 'Unknown';
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
