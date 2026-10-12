// ISO 3166 country table (alpha-2 | alpha-3 | numeric | English name) used to match traffic data to the world map.
// GA4 gives country NAMES, Search Console gives alpha-3 codes, the estimate gives alpha-2 codes, the map uses numeric ids.
const RAW =
  "AF|AFG|4|Afghanistan;AX|ALA|248|Åland Islands;AL|ALB|8|Albania;DZ|DZA|12|Algeria;AS|ASM|16|American Samoa;AD|AND|20|Andorra;AO|AGO|24|Angola;AI|AIA|660|Anguilla;AQ|ATA|10|Antarctica;AG|ATG|28|Antigua and Barbuda;AR|ARG|32|Argentina;AM|ARM|51|Armenia;AW|ABW|533|Aruba;AU|AUS|36|Australia;AT|AUT|40|Austria;AZ|AZE|31|Azerbaijan;BS|BHS|44|Bahamas;BH|BHR|48|Bahrain;BD|BGD|50|Bangladesh;BB|BRB|52|Barbados;BY|BLR|112|Belarus;BE|BEL|56|Belgium;BZ|BLZ|84|Belize;BJ|BEN|204|Benin;BM|BMU|60|Bermuda;BT|BTN|64|Bhutan;BO|BOL|68|Bolivia;BQ|BES|535|Bonaire, Sint Eustatius and Saba;BA|BIH|70|Bosnia and Herzegovina;BW|BWA|72|Botswana;BV|BVT|74|Bouvet Island;BR|BRA|76|Brazil;IO|IOT|86|British Indian Ocean Territory;BN|BRN|96|Brunei Darussalam;BG|BGR|100|Bulgaria;BF|BFA|854|Burkina Faso;BI|BDI|108|Burundi;KH|KHM|116|Cambodia;CM|CMR|120|Cameroon;CA|CAN|124|Canada;CV|CPV|132|Cape Verde;KY|CYM|136|Cayman Islands;CF|CAF|140|Central African Republic;TD|TCD|148|Chad;CL|CHL|152|Chile;CX|CXR|162|Christmas Island;CC|CCK|166|Cocos (Keeling) Islands;CO|COL|170|Colombia;KM|COM|174|Comoros;CK|COK|184|Cook Islands;CR|CRI|188|Costa Rica;CI|CIV|384|Cote d'Ivoire;HR|HRV|191|Croatia;CU|CUB|192|Cuba;CW|CUW|531|Curaçao;CY|CYP|196|Cyprus;CZ|CZE|203|Czech Republic;CD|COD|180|Democratic Republic of the Congo;DK|DNK|208|Denmark;DJ|DJI|262|Djibouti;DM|DMA|212|Dominica;DO|DOM|214|Dominican Republic;EC|ECU|218|Ecuador;EG|EGY|818|Egypt;SV|SLV|222|El Salvador;GQ|GNQ|226|Equatorial Guinea;ER|ERI|232|Eritrea;EE|EST|233|Estonia;SZ|SWZ|748|Eswatini;ET|ETH|231|Ethiopia;FK|FLK|238|Falkland Islands (Malvinas);FO|FRO|234|Faroe Islands;FJ|FJI|242|Fiji;FI|FIN|246|Finland;FR|FRA|250|France;GF|GUF|254|French Guiana;PF|PYF|258|French Polynesia;TF|ATF|260|French Southern Territories;GA|GAB|266|Gabon;GE|GEO|268|Georgia;DE|DEU|276|Germany;GH|GHA|288|Ghana;GI|GIB|292|Gibraltar;GR|GRC|300|Greece;GL|GRL|304|Greenland;GD|GRD|308|Grenada;GP|GLP|312|Guadeloupe;GU|GUM|316|Guam;GT|GTM|320|Guatemala;GG|GGY|831|Guernsey;GN|GIN|324|Guinea;GW|GNB|624|Guinea-Bissau;GY|GUY|328|Guyana;HT|HTI|332|Haiti;HM|HMD|334|Heard Island and McDonald Islands;VA|VAT|336|Holy See (Vatican City State);HN|HND|340|Honduras;HK|HKG|344|Hong Kong;HU|HUN|348|Hungary;IS|ISL|352|Iceland;IN|IND|356|India;ID|IDN|360|Indonesia;IQ|IRQ|368|Iraq;IE|IRL|372|Ireland;IR|IRN|364|Islamic Republic of Iran;IM|IMN|833|Isle of Man;IL|ISR|376|Israel;IT|ITA|380|Italy;JM|JAM|388|Jamaica;JP|JPN|392|Japan;JE|JEY|832|Jersey;JO|JOR|400|Jordan;KZ|KAZ|398|Kazakhstan;KE|KEN|404|Kenya;KI|KIR|296|Kiribati;XK|XKK|983|Kosovo;KW|KWT|414|Kuwait;KG|KGZ|417|Kyrgyzstan;LA|LAO|418|Lao People's Democratic Republic;LV|LVA|428|Latvia;LB|LBN|422|Lebanon;LS|LSO|426|Lesotho;LR|LBR|430|Liberia;LY|LBY|434|Libya;LI|LIE|438|Liechtenstein;LT|LTU|440|Lithuania;LU|LUX|442|Luxembourg;MO|MAC|446|Macao;MG|MDG|450|Madagascar;MW|MWI|454|Malawi;MY|MYS|458|Malaysia;MV|MDV|462|Maldives;ML|MLI|466|Mali;MT|MLT|470|Malta;MH|MHL|584|Marshall Islands;MQ|MTQ|474|Martinique;MR|MRT|478|Mauritania;MU|MUS|480|Mauritius;YT|MYT|175|Mayotte;MX|MEX|484|Mexico;FM|FSM|583|Micronesia, Federated States of;MD|MDA|498|Moldova, Republic of;MC|MCO|492|Monaco;MN|MNG|496|Mongolia;ME|MNE|499|Montenegro;MS|MSR|500|Montserrat;MA|MAR|504|Morocco;MZ|MOZ|508|Mozambique;MM|MMR|104|Myanmar;NA|NAM|516|Namibia;NR|NRU|520|Nauru;NP|NPL|524|Nepal;NL|NLD|528|Netherlands;NC|NCL|540|New Caledonia;NZ|NZL|554|New Zealand;NI|NIC|558|Nicaragua;NE|NER|562|Niger;NG|NGA|566|Nigeria;NU|NIU|570|Niue;NF|NFK|574|Norfolk Island;KP|PRK|408|North Korea;MP|MNP|580|Northern Mariana Islands;NO|NOR|578|Norway;OM|OMN|512|Oman;PK|PAK|586|Pakistan;PW|PLW|585|Palau;PA|PAN|591|Panama;PG|PNG|598|Papua New Guinea;PY|PRY|600|Paraguay;CN|CHN|156|People's Republic of China;PE|PER|604|Peru;PH|PHL|608|Philippines;PN|PCN|612|Pitcairn;PL|POL|616|Poland;PT|PRT|620|Portugal;PR|PRI|630|Puerto Rico;QA|QAT|634|Qatar;CG|COG|178|Republic of the Congo;GM|GMB|270|Republic of The Gambia;RE|REU|638|Reunion;RO|ROU|642|Romania;RU|RUS|643|Russian Federation;RW|RWA|646|Rwanda;BL|BLM|652|Saint Barthélemy;SH|SHN|654|Saint Helena;KN|KNA|659|Saint Kitts and Nevis;LC|LCA|662|Saint Lucia;MF|MAF|663|Saint Martin (French part);PM|SPM|666|Saint Pierre and Miquelon;VC|VCT|670|Saint Vincent and the Grenadines;WS|WSM|882|Samoa;SM|SMR|674|San Marino;ST|STP|678|Sao Tome and Principe;SA|SAU|682|Saudi Arabia;SN|SEN|686|Senegal;RS|SRB|688|Serbia;SC|SYC|690|Seychelles;SL|SLE|694|Sierra Leone;SG|SGP|702|Singapore;SX|SXM|534|Sint Maarten (Dutch part);SK|SVK|703|Slovakia;SI|SVN|705|Slovenia;SB|SLB|90|Solomon Islands;SO|SOM|706|Somalia;ZA|ZAF|710|South Africa;GS|SGS|239|South Georgia and the South Sandwich Islands;KR|KOR|410|South Korea;SS|SSD|728|South Sudan;ES|ESP|724|Spain;LK|LKA|144|Sri Lanka;PS|PSE|275|State of Palestine;SD|SDN|729|Sudan;SR|SUR|740|Suriname;SJ|SJM|744|Svalbard and Jan Mayen;SE|SWE|752|Sweden;CH|CHE|756|Switzerland;SY|SYR|760|Syrian Arab Republic;TW|TWN|158|Taiwan, Province of China;TJ|TJK|762|Tajikistan;TH|THA|764|Thailand;MK|MKD|807|The Republic of North Macedonia;TL|TLS|626|Timor-Leste;TG|TGO|768|Togo;TK|TKL|772|Tokelau;TO|TON|776|Tonga;TT|TTO|780|Trinidad and Tobago;TN|TUN|788|Tunisia;TR|TUR|792|Türkiye;TM|TKM|795|Turkmenistan;TC|TCA|796|Turks and Caicos Islands;TV|TUV|798|Tuvalu;UG|UGA|800|Uganda;UA|UKR|804|Ukraine;AE|ARE|784|United Arab Emirates;GB|GBR|826|United Kingdom;TZ|TZA|834|United Republic of Tanzania;UM|UMI|581|United States Minor Outlying Islands;US|USA|840|United States of America;UY|URY|858|Uruguay;UZ|UZB|860|Uzbekistan;VU|VUT|548|Vanuatu;VE|VEN|862|Venezuela;VN|VNM|704|Vietnam;VG|VGB|92|Virgin Islands, British;VI|VIR|850|Virgin Islands, U.S.;WF|WLF|876|Wallis and Futuna;EH|ESH|732|Western Sahara;YE|YEM|887|Yemen;ZM|ZMB|894|Zambia;ZW|ZWE|716|Zimbabwe";

export type Country = { a2: string; a3: string; num: string; name: string };

export const COUNTRIES: Country[] = RAW.split(";").map((r) => {
  const [a2, a3, num, name] = r.split("|");
  return { a2, a3, num, name };
});

// friendlier display names than the official ISO ones
const NAME_FIX: Record<string, string> = {
  US: "United States",
  RU: "Russia",
  IR: "Iran",
  SY: "Syria",
  TZ: "Tanzania",
  MD: "Moldova",
  LA: "Laos",
  BN: "Brunei",
  CZ: "Czechia",
  CD: "DR Congo",
  CG: "Congo",
  PS: "Palestine",
  MK: "North Macedonia",
  FM: "Micronesia",
  TW: "Taiwan",
  CI: "Côte d'Ivoire",
  VA: "Vatican City",
  FK: "Falkland Islands",
};
for (const c of COUNTRIES) if (NAME_FIX[c.a2]) c.name = NAME_FIX[c.a2];

const byA2 = new Map(COUNTRIES.map((c) => [c.a2, c]));
const byA3 = new Map(COUNTRIES.map((c) => [c.a3, c]));
const byNum = new Map(COUNTRIES.map((c) => [String(parseInt(c.num, 10)), c]));

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/\bst\.?\s/g, "saint ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// names that GA4 / Google use but the ISO list spells differently
const ALIAS: Record<string, string> = {
  "united states": "US",
  usa: "US",
  uk: "GB",
  turkiye: "TR",
  turkey: "TR",
  "south korea": "KR",
  korea: "KR",
  russia: "RU",
  vietnam: "VN",
  "viet nam": "VN",
  czechia: "CZ",
  "czech republic": "CZ",
  "hong kong": "HK",
  macao: "MO",
  macau: "MO",
  taiwan: "TW",
  "myanmar burma": "MM",
  myanmar: "MM",
  "congo kinshasa": "CD",
  "congo brazzaville": "CG",
  "cote d ivoire": "CI",
  "ivory coast": "CI",
  laos: "LA",
  syria: "SY",
  iran: "IR",
  bolivia: "BO",
  venezuela: "VE",
  tanzania: "TZ",
  moldova: "MD",
  brunei: "BN",
  palestine: "PS",
  "palestinian territories": "PS",
  eswatini: "SZ",
  swaziland: "SZ",
  "north macedonia": "MK",
  "cape verde": "CV",
  "cabo verde": "CV",
  "timor leste": "TL",
  micronesia: "FM",
  "bosnia and herzegovina": "BA",
  "trinidad and tobago": "TT",
  "saint kitts and nevis": "KN",
  "antigua and barbuda": "AG",
  "saint vincent and grenadines": "VC",
  "saint vincent and the grenadines": "VC",
  "falkland islands islas malvinas": "FK",
  "the netherlands": "NL",
  "the bahamas": "BS",
  "the gambia": "GM",
};
const byName = new Map<string, Country>();
for (const c of COUNTRIES) byName.set(norm(c.name), c);
for (const [k, v] of Object.entries(ALIAS)) {
  const c = byA2.get(v);
  if (c) byName.set(k, c);
}

/** Find a country from a GA4 name, an alpha-2 / alpha-3 code or a plain name. Returns null for "(not set)" and unknown values. */
export function findCountry(input: string | null | undefined): Country | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw || /not set/i.test(raw)) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) return byA2.get(raw.toUpperCase()) ?? null;
  if (/^[A-Za-z]{3}$/.test(raw) && byA3.has(raw.toUpperCase()))
    return byA3.get(raw.toUpperCase()) ?? null;
  return byName.get(norm(raw)) ?? null;
}
export const countryByMapId = (id: string | number | undefined) =>
  id == null ? null : (byNum.get(String(parseInt(String(id), 10))) ?? null);

/** Flag emoji from an alpha-2 code (shows as letters on Windows, which is fine). */
export const flag = (a2: string) =>
  String.fromCodePoint(
    ...a2
      .toUpperCase()
      .split("")
      .map((ch) => 127397 + ch.charCodeAt(0)),
  );
