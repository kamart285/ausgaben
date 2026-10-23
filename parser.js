/* Beleg-Parser: macht aus OCR-Text Betrag, Geschäft, Datum, Kategorie, Notiz.
   Reine Funktionen ohne DOM – läuft im Browser (window.BelegParser) und in Node (module.exports). */
(function(root){
'use strict';

// ---------- Hilfen ----------
function pad(n){ return (n < 10 ? '0' : '') + n; }
function fold(s){   // Großbuchstaben, Umlaute vereinfacht, Leerraum zusammengezogen (nur zum Suchen)
  return String(s).toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE').replace(/ß/g, 'SS')
    .replace(/[\u00a0\u202f\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}
function titleCase(s){
  return s.toLowerCase().replace(/(^|[\s\-\/(])([a-zäöüß])/g, function(m, a, b){ return a + b.toUpperCase(); });
}
function cleanName(s){
  s = String(s).replace(/[|_~\[\]{}<>*=#]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(GmbH\s*&\s*Co\.?\s*KG|GmbH\s*\+\s*Co\.?\s*KG|GmbH|AG\s*&\s*Co\.?\s*KG|mbH|S\.?E\.?|AG|KG|e\.\s?K\.|e\.\s?V\.|Inh\.?.*|Ltd\.?|Inc\.?)\s*$/i, '').trim();
  s = s.replace(/[,;:.\-–\s]+$/, '').replace(/^[,;:.\-–\s]+/, '');
  if (s.length > 3 && s === s.toUpperCase() && /[A-ZÄÖÜ]{3}/.test(s)) s = titleCase(s);
  return s;
}

// ---------- Geschäfte (Name, Muster, Art) ----------
// k = Art der Ausgabe -> wird auf die Kategorien der App abgebildet; w = Gewicht (Online-Shops verkaufen alles -> klein)
var CHAINS = [
  ['Rewe', /\bR[E3]WE\b/i, 'food'], ['Edeka', /\bEDEKA\b|\bE[ -]?CENTER\b/i, 'food'], ['Aldi', /\bALDI\b/i, 'food'],
  ['Lidl', /\bL[I1]DL\b/i, 'food'], ['Kaufland', /\bKAUFLAND\b/i, 'food'], ['Penny', /\bPENNY\b/i, 'food'],
  ['Netto', /\bNETTO (MARKEN|DISCOUNT)|\bNETTO\b(?!\s*\d)/i, 'food', 0.7], ['Norma', /\bNORMA\b/i, 'food'], ['Globus', /\bGLOBUS\b/i, 'food'],
  ['Tegut', /\bTEGUT\b/i, 'food'], ['Alnatura', /\bALNATURA\b/i, 'food'], ['Denn\'s Biomarkt', /\bDENN'?S\b/i, 'food'],
  ['Marktkauf', /\bMARKTKAUF\b/i, 'food'], ['Metro', /\bMETRO (CASH|AG|GROSS)/i, 'food'], ['Hit', /\bHIT[ -]?MARKT\b/i, 'food'],
  ['dm', /\bDM[- ]?DROGERIE|\bDM[- ]MARKT\b|^\s*DM\s*$/im, 'drug'], ['Rossmann', /\bR[O0]SSMANN\b/i, 'drug'],
  ['Müller', /\bM(Ü|UE|U)LLER (DROGERIE|HANDELS|MARKT)|\bMUELLER\b.*\bDROGERIE|\bM(Ü|UE)LLER\b\s*$/im, 'drug', 0.7], ['Budni', /\bBUDNI\b/i, 'drug'],
  ['Douglas', /\bDOUGLAS\b/i, 'drug', 0.7],
  ['Aral', /\bARAL\b/i, 'fuel'], ['Shell', /\bSHELL\b/i, 'fuel'], ['Esso', /\bESSO\b/i, 'fuel'], ['Jet', /\bJET[- ]TANK|\bJET\s+STATION/i, 'fuel'],
  ['TotalEnergies', /\bTOTAL ?ENERGIES\b|\bTOTAL (TANK|STATION)/i, 'fuel'], ['Agip', /\bAGIP\b|\bENI\b(?= TANK| STATION)/i, 'fuel'], ['HEM', /\bHEM\b(?= TANK| STATION)/i, 'fuel'],
  ['OMV', /\bOMV\b/i, 'fuel'], ['Star', /\bSTAR TANKSTELLE\b/i, 'fuel'],
  ["McDonald's", /MC ?DONALD/i, 'eat'], ['Burger King', /BURGER ?KING/i, 'eat'], ['Subway', /\bSUBWAY\b/i, 'eat'], ['Starbucks', /STARBUCKS/i, 'eat'],
  ['KFC', /\bKFC\b/i, 'eat'], ['Nordsee', /\bNORDSEE\b/i, 'eat'], ['Vapiano', /\bVAPIANO\b/i, 'eat'], ['Lieferando', /\bLIEFERANDO\b/i, 'eat', 1], ['Wolt', /\bWOLT\b/i, 'eat', 1],
  ['Uber Eats', /\bUBER ?EATS\b/i, 'eat', 1], ['Domino\'s', /\bDOMINO'?S\b/i, 'eat'], ['Pizza Hut', /\bPIZZA ?HUT\b/i, 'eat'],
  ['IKEA', /\bIKEA\b/i, 'home'], ['OBI', /\bOBI\b(?= (BAU|MARKT|GMBH))|\bOBI (BAU|MARKT)/i, 'home'], ['Bauhaus', /\bBAUHAUS\b/i, 'home'], ['Hornbach', /\bHORNBACH\b/i, 'home'],
  ['Toom', /\bTOOM\b/i, 'home'], ['Action', /\bACTION (DEUTSCHLAND|GMBH)|\bACTION\s*$/im, 'home', 0.8], ['TEDi', /\bTEDI\b/i, 'home'], ['Depot', /\bDEPOT\s*$/im, 'home', 0.7],
  ['Decathlon', /\bDECATHLON\b/i, 'leisure'], ['Intersport', /\bINTERSPORT\b/i, 'leisure'], ['SportScheck', /\bSPORT ?SCHECK\b/i, 'leisure'],
  ['H&M', /\bH ?& ?M\b/i, 'cloth'], ['Zara', /\bZARA\b/i, 'cloth'], ['C&A', /\bC ?& ?A\b/i, 'cloth'], ['Primark', /\bPRIMARK\b/i, 'cloth'], ['Deichmann', /\bDEICHMANN\b/i, 'cloth'],
  ['Zalando', /\bZALANDO\b/i, 'cloth'], ['About You', /\bABOUT ?YOU\b/i, 'cloth'], ['Orsay', /\bORSAY\b/i, 'cloth'], ['Esprit', /\bESPRIT\b/i, 'cloth'], ['Peek & Cloppenburg', /PEEK ?& ?CLOPPENBURG/i, 'cloth'],
  ['MediaMarkt', /MEDIA ?MARKT/i, 'tech'], ['Saturn', /\bSATURN\b/i, 'tech'], ['Cyberport', /\bCYBERPORT\b/i, 'tech'], ['Conrad', /\bCONRAD ELECTRONIC|\bCONRAD\b/i, 'tech'],
  ['Notebooksbilliger', /NOTEBOOKSBILLIGER/i, 'tech'], ['Alternate', /\bALTERNATE\b/i, 'tech'], ['Mindfactory', /MINDFACTORY/i, 'tech'],
  ['Thalia', /\bTHALIA\b/i, 'gift', 0.7], ['Hugendubel', /\bHUGENDUBEL\b/i, 'gift', 0.7], ['Fressnapf', /\bFRESSNAPF\b/i, 'home'], ['Zooplus', /\bZOOPLUS\b/i, 'home'],
  ['Amazon', /\bAMAZON\b|AMAZON\.DE|AMZN|\b\d{3}-\d{7}-\d{7}\b/i, 'misc', 0.2, 1], ['eBay', /\bE ?BAY\b/i, 'misc', 0.2, 1], ['PayPal', /\bPAY ?PAL\b/i, 'misc', 0.2, 1], ['Otto', /\bOTTO\.DE|\bOTTO (GMBH|VERSAND)/i, 'misc', 0.3, 1],
  ['Temu', /\bTEMU\b/i, 'misc', 0.2, 1], ['Shein', /\bSHEIN\b/i, 'cloth', 0.5, 1],
  ['Apple', /\bAPPLE\b|\bITUNES\b|\bICLOUD\b|APP ?STORE/i, 'misc', 0.2, 1], ['Google Play', /GOOGLE ?PLAY|\bGOOGLE\b/i, 'leisure', 0.3, 1],
  ['Netflix', /\bNETFLIX\b/i, 'leisure', 1, 1], ['Spotify', /\bSPOTIFY\b/i, 'leisure', 1, 1], ['Disney+', /DISNEY ?\+|DISNEY ?PLUS/i, 'leisure', 1, 1], ['Steam', /\bSTEAM\b(?= (GAMES|PURCHASE|KAUF))/i, 'leisure', 1, 1],
  ['Microsoft', /\bMICROSOFT\b/i, 'tech', 0.3, 1], ['Booking.com', /BOOKING\.COM/i, 'leisure', 0.6, 1], ['Airbnb', /\bAIRBNB\b/i, 'leisure', 0.6, 1],
  ['Deutsche Bahn', /DEUTSCHE BAHN|\bDB (FERNVERKEHR|REGIO|VERTRIEB)|\bBAHN\.DE/i, 'misc', 0.3, 1], ['Flixbus', /\bFLIXBUS\b/i, 'misc', 0.3, 1], ['Uber', /\bUBER\b(?! ?EATS)/i, 'misc', 0.3, 1],
  ['Kino', /\bKINO\b|\bCINEMAXX\b|\bCINESTAR\b/i, 'leisure', 0.8], ['Apotheke', /\bAPOTHEKE\b/i, 'health', 1, 0, 1],
  ['Bäckerei', /B(Ä|AE|A)CKEREI|\bB(Ä|AE)CKER\b|KONDITOREI|\bBACKSTUBE\b/i, 'eat', 0.8, 0, 1],
  ['Restaurant', /RESTAURANT|PIZZERIA|TRATTORIA|GASTST(Ä|AE)TTE|\bGASTHAUS\b|\bIMBISS\b|\bBISTRO\b|\bCAF(É|E)\b|\bEISCAFE\b|\bBRAUHAUS\b/i, 'eat', 0.8, 0, 1]
].map(function(c){ return { name: c[0], re: c[1], kind: c[2], w: c[3] == null ? 1 : c[3], online: !!c[4], useLine: !!c[5] }; });

// ---------- Kategorie-Stichwörter (Positionen) ----------
var KIND_WORDS = {
  fuel:  /\b(BENZIN|SUPER ?E ?(5|10)|E10|E5|DIESEL|KRAFTSTOFF|ZAPFS(Ä|AE)ULE|SAEULE \d|ADBLUE|V-?POWER|ULTIMATE)\b|\bEUR\/L\b|\b\d+[,.]\d{2,3} ?L\b/i,
  food:  /\b(MILCH|BROT|K(Ä|AE)SE|WURST|OBST|GEM(Ü|UE)SE|JOGHURT|NUDELN|BUTTER|EIER|FLEISCH|H(Ä|AE)HNCHEN|PFAND|SPRUDEL|MINERALWASSER|SCHINKEN|SALAT|TOMATEN|BANANEN|APFEL|(Ä|AE)PFEL|REIS|OLIVEN(Ö|OE)L|MEHL|ZUCKER|HACKFLEISCH|LACHS)/i,
  eat:   /\b(MEN(Ü|UE)|CAPPUCCINO|LATTE|ESPRESSO|PIZZA|BURGER|TRINKGELD|BEDIENUNG|TISCH \d|BR(Ö|OE)TCHEN|BREZEL|LIEFERKOSTEN|LIEFERGEB(Ü|UE)HR|CURRY|D(Ö|OE)NER|SUSHI)/i,
  drug:  /\b(SHAMPOO|DUSCHGEL|ZAHNPASTA|DEO(DORANT)?|WATTEPADS|SEIFE|WINDELN?|ZAHNB(Ü|UE)RSTE|HAARGUMMI|TASCHENT(Ü|UE)CHER|NIVEA|MUNDSP(Ü|UE)LUNG|SONNENCREME)/i,
  health:/\b(APOTHEKE|IBUPROFEN|HUSTENSAFT|NASENSPRAY|TABLETTEN|REZEPT|ARZNEI|PZN|PARACETAMOL|VITAMIN|MAGNESIUM|PFLASTER)/i,
  cloth: /\b(SHIRT|T-SHIRT|HOSE|JEANS|JACKE|PULLOVER|HEMD|KLEID|SOCKEN|SCHUHE|SNEAKER|M(Ü|UE)TZE|GR(Ö|OE)SSE [A-Z0-9]{1,3}\b)/i,
  tech:  /\b(KABEL|LADEGER(Ä|AE)T|USB|HDMI|KOPFH(Ö|OE)RER|LAPTOP|NOTEBOOK|HANDY|SMARTPHONE|MONITOR|AKKU|MAUS|TASTATUR|SPEICHERKARTE|SSD|ROUTER|POWERBANK|BLUETOOTH|CHARGER)/i,
  home:  /\b(LAMPE|LED|GL(Ü|UE)HBIRNE|LEUCHTE|K(Ü|UE)CHE|REINIGER|M(Ü|UE)LLBEUTEL|KERZE|DEKO|HANDTUCH|BETTW(Ä|AE)SCHE|TOPF|PFANNE|SCHRAUBE|FARBE|WERKZEUG|BLUMEN|PFLANZE)/i,
  leisure:/\b(ABO|ABONNEMENT|PREMIUM|STREAMING|FITNESS|KINO|EINTRITT|TICKET|SPIEL|LAUFSCHUHE|SPORT|TRAININGS?|YOGA|RADSPORT|FUSSBALL)/i,
  gift:  /\b(GESCHENK|GUTSCHEIN|GRUSSKARTE|GESCHENKPAPIER)/i
};
var KIND_CAT = {   // Art -> Kategorie der App (Standard-ID oder Name)
  food:    { ids: ['lebensmittel'], re: /lebensmittel|supermarkt|einkauf|essen & |nahrung/i },
  drug:    { ids: ['drogerie'], re: /drogerie|pflege|kosmetik/i },
  fuel:    { ids: ['auto'], re: /tank|auto|kfz|fahrzeug|verkehr|mobil/i },
  eat:     { ids: ['restaurant'], re: /restaurant|caf(é|e)|gastro|essen gehen|lokal/i },
  cloth:   { ids: ['kleidung'], re: /kleid|mode|textil|bekleidung/i },
  home:    { ids: ['haushalt'], re: /haushalt|wohnen|garten|bau|heim/i },
  leisure: { ids: ['freizeit'], re: /freizeit|sport|hobby|unterhaltung|reisen|urlaub/i },
  health:  { ids: ['gesundheit'], re: /gesund|apotheke|arzt|medizin/i },
  tech:    { ids: ['elektronik'], re: /elektronik|technik|computer|handy|it\b/i },
  gift:    { ids: ['geschenke'], re: /geschenk/i },
  misc:    { ids: ['sonstiges'], re: /sonstig|allgemein|diverses|andere/i }
};
function kindToCat(kind, cats){
  var m = KIND_CAT[kind]; if (!m || !cats) return null;
  var i;
  for (i = 0; i < cats.length; i++) if (m.ids.indexOf(cats[i].id) >= 0) return cats[i].id;
  for (i = 0; i < cats.length; i++) if (m.re.test(cats[i].name)) return cats[i].id;
  return null;
}

// ---------- Betrag ----------
var MONEY = /(^|[^\d.,])(\d{1,3}(?:[.\u2009 ]\d{3})+|\d+)[,.] ?(\d{2})(?!\d)/g;
function moneyTokens(line){
  var out = [], m, s = fixDigits(line);
  MONEY.lastIndex = 0;
  while ((m = MONEY.exec(s))){
    var ip = m[2].replace(/[.\u2009 ]/g, ''), v = Number(ip) * 100 + Number(m[3]);
    var before = s.slice(0, m.index + m[1].length);
    var neg = /[-−–]\s*$/.test(before) && !/\d\s*[-−–]\s*$/.test(before);
    if (v > 0 && v <= 9999999 && !neg) out.push({ v: v, idx: m.index });
    MONEY.lastIndex = m.index + m[0].length - 1;
  }
  return out;
}
function fixDigits(s){   // typische OCR-Verwechslungen nur in Zahlen korrigieren (O->0, l/I->1)
  return String(s).replace(/(\d)[Oo](?![A-Za-z])/g, '$10').replace(/([,.])[Oo](?=\d)/g, '$10').replace(/(\d)[lI](?=[\d,.]\d)/g, '$11')
    .replace(/(^|[^A-Za-z\d])[lI](?=\d[,.]\d{2}\b)/g, '$11');
}
// Zeilen-Schlüsselwörter: [Muster, Punkte]
var KW = [
  [/\b(SUMME|GESAMTSUMME|GESAMTBETRAG|GESAMTPREIS|ENDBETRAG|ENDSUMME|RECHNUNGSBETRAG|RECHNUNGSSUMME|ZAHLBETRAG|BESTELLSUMME|BESTELLWERT|ORDER TOTAL|GRAND TOTAL|AMOUNT DUE|TOTAL AMOUNT|ZU ZAHLEN|ZU BEZAHLEN|GESAMT|TOTAL|TOTALE?|BETRAG)\b/, 5],
  [/\b(EC[- ]?KARTE|GIROCARD|GIRO ?CARD|KARTENZAHLUNG|KREDITKARTE|VISA|MASTERCARD|MAESTRO|DEBIT|BEZAHLT|BARGELD|ZAHLUNG|GEZAHLT|ABGEBUCHT)\b/, 2],
  [/\b(ZWISCHENSUMME|SUBTOTAL|ZWISCHENSUMME)\b/, 1.2]
];
var NEG = /\b(MWST|MWSt|UST|STEUER|NETTO|BRUTTO|MEHRWERTSTEUER|VAT|RUECKGELD|RUECKGABE|GEGEBEN|BAR GEGEBEN|WECHSELGELD|PFAND|VERSAND|VERSANDKOSTEN|LIEFERKOSTEN|LIEFERGEBUEHR|RABATT|ERSPARNIS|GESPART|PREIS ?\/ ?L|EUR ?\/ ?L|PAYBACK|PUNKTE|TRINKGELD|ARTIKEL|ENTHALTENE|ENTHALTEN|INKL)\b/;
function lineScore(f){
  if (/\bZWISCHENSUMME\b|\bSUBTOTAL\b/.test(f)) return 1.2;
  var s = 0, i;
  for (i = 0; i < KW.length; i++) if (KW[i][0].test(f)) { s = Math.max(s, KW[i][1]); }
  if (/\bBAR\b/.test(f) && !/\bGESAMT|SUMME|TOTAL\b/.test(f)) s = Math.max(s, 0.3);
  if (NEG.test(f) && s < 5) s = Math.min(s, 0) - 1;
  else if (NEG.test(f)) s -= 3;
  return s;
}
function findAmount(lines){
  var F = lines.map(fold), cands = {}, all = [], i, j, t;
  var itemSum = 0, itemCount = 0;
  for (i = 0; i < lines.length; i++){
    var toks = moneyTokens(lines[i]); if (!toks.length) continue;
    var sc = lineScore(F[i]);
    if (sc <= 0 && sc > -1 && i > 0){   // Betrag allein in der Zeile: Schlüsselwort steht in der Zeile davor
      var rest = lines[i].replace(/EUR|€|\d|[.,\s*A-C]/g, '');
      if (rest.length <= 1){ var ps = lineScore(F[i-1]); if (ps >= 2 && !moneyTokens(lines[i-1]).length) sc = ps * 0.9; }
    }
    // Position (Name + Preis) für die Prüfsumme
    if (toks.length === 1 && /[A-Za-zÄÖÜäöü]{3}/.test(lines[i]) && sc <= 0 && !NEG.test(F[i]) && /\s(?:EUR\s*)?\d+[.,]\d{2}\s*(?:€|EUR)?\s*[A-C*]?\s*$/.test(lines[i])){ itemSum += toks[0].v; itemCount++; }
    for (j = 0; j < toks.length; j++){
      t = toks[j];
      // letzter Betrag der Zeile zählt am meisten (Spalte rechts)
      var w = (toks.length > 1 && j < toks.length - 1) ? 0.6 : 1;
      all.push(t.v);
      var key = t.v;
      if (!cands[key]) cands[key] = { v: t.v, score: 0, n: 0, kw: 0 };
      cands[key].n++;
      if (sc > 0){ cands[key].score += sc * w; cands[key].kw = Math.max(cands[key].kw, sc); }
      else if (sc === 0){ cands[key].score += 0.25; }
      else cands[key].score += 0.0;
    }
  }
  var keys = Object.keys(cands); if (!keys.length) return { v: null, conf: 0 };
  keys.forEach(function(k){
    var c = cands[k]; if (c.n > 1 && c.score > 0.5) c.score += 0.6 * (c.n - 1);   // mehrfach genannt (SUMME + EC-Karte)
    if (itemCount >= 2 && c.v === itemSum) c.score += 3;                          // Summe der Positionen stimmt
    c.sumOk = itemCount >= 2 && c.v === itemSum;
  });
  var best = null;
  keys.forEach(function(k){ var c = cands[k]; if (!best || c.score > best.score || (c.score === best.score && c.v > best.v)) best = c; });
  var conf;
  if (best.kw >= 5) conf = (best.n > 1 || best.sumOk) ? 0.95 : 0.82;
  else if (best.kw >= 2) conf = best.sumOk ? 0.8 : 0.6;
  else if (best.sumOk) conf = 0.75;
  else conf = 0.3;
  if (best.kw < 2 && !best.sumOk){   // Notnagel: größter plausibler Betrag
    var mx = 0; all.forEach(function(v){ if (v > mx && v < 500000) mx = v; });
    best = { v: mx }; conf = 0.3;
  }
  return { v: best.v, conf: conf };
}

// ---------- Datum ----------
var MONTHS = { JAN:1, FEB:2, MAR:3, MRZ:3, APR:4, MAI:5, MAY:5, JUN:6, JUL:7, AUG:8, SEP:9, OKT:10, OCT:10, NOV:11, DEZ:12, DEC:12 };
function findDate(lines, now){
  var F = lines.map(fold), found = [], i, m;
  var maxT = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).getTime(), minT = new Date(now.getFullYear() - 6, 0, 1).getTime();
  function ok(y, mo, d){
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d); if (dt.getMonth() !== mo - 1) return null;
    var t = dt.getTime(); if (t > maxT || t < minT) return null;
    return { y: y, m: mo, d: d };
  }
  for (i = 0; i < lines.length; i++){
    var s = lines[i].replace(/[Oo](?=\d)/g, '0').replace(/(\d)[Oo]/g, '$10'), f = F[i], cand = [];
    var re = /(?:^|[^\d])(\d{1,2})\s?[.\/-]\s?(\d{1,2})\s?[.\/-]\s?(\d{4}|\d{2})(?!\d)/g;
    while ((m = re.exec(s))){ var r = ok(Number(m[3]), Number(m[2]), Number(m[1])); if (r) cand.push(r); }
    re = /(?:^|[^\d])(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
    while ((m = re.exec(s))){ var r2 = ok(Number(m[1]), Number(m[2]), Number(m[3])); if (r2) cand.push(r2); }
    re = /(\d{1,2})\.?\s*(JAN|FEB|MAR|MRZ|APR|MAI|MAY|JUN|JUL|AUG|SEP|OKT|OCT|NOV|DEZ|DEC)[A-Z]*\.?,?\s*(\d{4})/g;
    while ((m = re.exec(f))){ var r3 = ok(Number(m[3]), MONTHS[m[2]], Number(m[1])); if (r3) cand.push(r3); }
    re = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.? (\d{1,2}),? (\d{4})/g;
    while ((m = re.exec(f))){ var r4 = ok(Number(m[3]), MONTHS[m[1]], Number(m[2])); if (r4) cand.push(r4); }
    cand.forEach(function(c){
      var sc = 0;
      if (/\b(DATUM|BESTELLT|BESTELLDATUM|BESTELLT AM|GEKAUFT|KAUFDATUM|RECHNUNGSDATUM|BELEGDATUM|ORDER DATE|ORDERED|PURCHASED|BEZAHLT AM|ZAHLUNGSDATUM|DATE)\b/.test(f)) sc += 3;
      if (/LIEFER|ZUSTELL|ERWARTET|G(Ü|UE)LTIG|VERSAND|RETOURE|R(Ü|UE)CKGABE|\bBIS\b|ANKUNFT|ABHOLUNG|DELIVER/.test(f)) sc -= 3;
      var tm = /(\d{1,2})[:.](\d{2})(?::\d{2})?(?!\d)/.exec(s.replace(/\d{1,2}\s?[.\/-]\s?\d{1,2}\s?[.\/-]\s?\d{2,4}/g, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ')), time = null, k;
      if (tm && Number(tm[1]) < 24 && Number(tm[2]) < 60 && /[:]/.test(tm[0])) time = { h: Number(tm[1]), mi: Number(tm[2]) };
      for (k = 1; k <= 2 && !time; k++){   // Uhrzeit steht oft in der Nachbarzeile
        [i - k, i + k].forEach(function(n){
          if (time || n < 0 || n >= lines.length) return;
          var t2 = /(?:^|[^\d])([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?!\d)/.exec(lines[n]);
          if (t2 && !/\d[.\/-]\d/.test(lines[n].replace(t2[0], ''))) time = { h: Number(t2[1]), mi: Number(t2[2]) };
        });
      }
      found.push({ y: c.y, m: c.m, d: c.d, time: time, score: sc - i * 0.01, line: i });
    });
  }
  if (!found.length) return null;
  found.sort(function(a, b){ return b.score - a.score; });
  var b = found[0];
  return { y: b.y, m: b.m, d: b.d, h: b.time ? b.time.h : null, mi: b.time ? b.time.mi : null, conf: b.score >= 2 ? 0.92 : b.score > -1 ? 0.78 : 0.4 };
}

// ---------- Geschäft ----------
var HEAD_SKIP = /(LIEFER|ZUSTELL|VIELEN|DANKE|THANK|MENGE|ZAHLUNG|ARTIKEL|GROESSE|DONNERSTAG|MONTAG|DIENSTAG|MITTWOCH|FREITAG|SAMSTAG|SONNTAG|KASSENBON|KASSENZETTEL|\bBON\b|BELEG|RECHNUNG|QUITTUNG|BESTELL|VIELEN DANK|\bTEL\b|TELEFON|\bFAX\b|WWW\.|HTTP|@|UST[- ]?ID|STEUER|DATUM|\d{5}\b|STRASSE|\bSTR\.|\bWEG\b|\bPLATZ\b|FILIALE|KUNDENBELEG|HAENDLER|HAENDLERBELEG|WILLKOMMEN|ORDER|EUR|\bNR\b)/;
function findShop(lines){
  lines = lines.map(function(l){ return /(STEUER|MWST|MW\.?\s?ST|UST)\b.*\bNETTO|\bNETTO\s+BRU/i.test(l) ? '' : l; });   // Steuer-Tabellenkopf ist kein Geschäft
  var i, j, top = [], F = lines.map(fold);
  for (i = 0; i < lines.length && top.length < 12; i++) if (lines[i].trim()) top.push(i);
  var best = null;
  for (i = 0; i < CHAINS.length; i++){
    var c = CHAINS[i], pos = -1;
    for (j = 0; j < lines.length; j++){
      if (!lines[j].trim()) continue;
      if (c.re.test(lines[j]) || c.re.test(F[j])){ pos = j; break; }
    }
    if (pos < 0) continue;
    var rank = top.indexOf(pos);   // Platz unter den obersten nicht-leeren Zeilen
    if (rank < 0){ if (!c.online) continue; rank = 20 + pos; }
    if (c.online && rank > 6 && rank < 20) continue;
    var key = rank - (c.w >= 1 ? 0.5 : 0);
    if (!best || key < best.key) best = { chain: c, pos: pos, key: key, rank: rank };
  }
  if (best){
    var c2 = best.chain, name = c2.name, conf = best.rank <= 3 ? 0.95 : best.rank < 20 ? 0.8 : 0.65;
    if (c2.useLine){ var ln = cleanName(lines[best.pos]); if (ln.length >= 4 && ln.length <= 40) name = ln; }
    if (c2.name === 'PayPal'){   // "Zahlung ... an Zalando SE": der Händler zählt, nicht PayPal
      for (j = 0; j < lines.length; j++){
        var m = /^\s*(?:an|bei|to)\s+([A-ZÄÖÜ][^\n]{2,40})$/.exec(lines[j]);
        if (m){ var nm = cleanName(m[1]), sub = null;
          CHAINS.forEach(function(cc){ if (!sub && cc.name !== 'PayPal' && (cc.re.test(nm) || cc.re.test(fold(nm)))) sub = cc; });
          return { name: sub ? sub.name : nm, conf: 0.8, chain: sub };
        }
      }
    }
    return { name: name, conf: conf, chain: c2 };
  }
  // Notlösung: erste brauchbare Kopfzeile
  for (i = 0; i < top.length && i < 6; i++){
    var ln2 = lines[top[i]].trim(), f2 = F[top[i]];
    var letters = (ln2.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
    if (letters < 3 || letters / ln2.length < 0.6 || HEAD_SKIP.test(f2) || ln2.length > 45) continue;
    var nm2 = cleanName(ln2); if (nm2.length >= 3) return { name: nm2, conf: 0.4, chain: null };
  }
  return { name: '', conf: 0, chain: null };
}

// ---------- Notiz (Positionen) ----------
var ITEM_SKIP2 = /GESAMT|SUMME|ZAHLEN|ZAHLUNG|BARGELD|RUECKG|VERSAND|MWST|STEUER|ZWISCHEN|BETRAG|^EUR\b|\bEUR$|MONATLICH|^ABO\b|JAEHRLICH|BESTELL|LIEFER|RECHNUNG|GUTSCHEIN|TREUE|PUNKTE|BONUS|^IU ZAHL/;
var ITEM_SKIP = /\b(SUMME|GESAMT|TOTAL|MWST|UST|STEUER|NETTO|BRUTTO|GEGEBEN|RUECKGELD|BAR|KARTE|EC|GIROCARD|VISA|MASTERCARD|PFAND|VERSAND|ZWISCHENSUMME|RABATT|BETRAG|ZAHLUNG|PAYBACK|LIEFERKOSTEN|VERPACKUNG|ENTHALTENE|MENGE|PREIS|BEZAHLT|SUBTOTAL|ZAHLUNGSART|ARTIKEL|RUECKGELD)\b/;
function tidyItem(s){
  s = s.replace(/^\s*\d+\s*[xX×]\s+/, '').replace(/^\s*\d{1,2}\s+(?=[A-Za-zÄÖÜ])/, '').replace(/[|_~*]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/[\s.,:;\-]+$/, '');
  if (s.length > 28 && s.indexOf(',') > 8) s = s.slice(0, s.indexOf(','));
  if (s.length > 34) s = s.slice(0, 34).replace(/\s+\S*$/, '');
  if (s === s.toUpperCase() && s.length > 3) s = titleCase(s);
  return s;
}
function findNote(lines){
  var F = lines.map(fold), items = [], i;
  for (i = 0; i < lines.length; i++){
    var ln = lines[i];
    var m = /^\s*(.*?[A-Za-zÄÖÜäöüß].*?)\s+(?:EUR\s*)?(\d{1,4}[,.] ?\d{2})\s*(?:€|EUR)?\s*[A-C*]?\s*$/.exec(ln);
    if (m && !ITEM_SKIP.test(F[i]) && !ITEM_SKIP2.test(F[i]) && !/^\s*\d+[,.]/.test(ln)){
      var name = tidyItem(m[1]);
      if (name.length >= 3 && /[A-Za-zÄÖÜäöü]{3}/.test(name)) items.push({ name: name, v: moneyTokens(m[2])[0] ? moneyTokens(m[2])[0].v : 0, i: i });
    }
  }
  if (!items.length){   // Online-Bestätigung: Produktname steht über der Preiszeile
    for (i = 1; i < lines.length; i++){
      if (/^\s*(?:EUR\s*)?\d{1,4}[,.] ?\d{2}\s*(?:€|EUR)?\s*$/.test(lines[i]) && !ITEM_SKIP.test(F[i-1])){
        for (var k = 1; k <= 3 && i - k >= 0; k++){
          var p = lines[i-k].trim(), fp = F[i-k];
          if ((p.match(/[A-Za-zÄÖÜäöüß]/g) || []).length >= 8 && p.length <= 90 && !ITEM_SKIP.test(fp) && !ITEM_SKIP2.test(fp) &&
              !/^(MENGE|GROESSE|ANZAHL|BESTELLT|BESTELLNUMMER|BESTELLUNG|LIEFERUNG|DATUM|VIELEN DANK|DEINE|IHRE|ARTIKEL|ZAHLUNG|ABO|RECHNUNG|BESTELLBEST)/.test(fp) && !moneyTokens(p).length){
            items.push({ name: tidyItem(p), v: moneyTokens(lines[i])[0].v, i: i - k }); break;
          }
        }
      }
    }
  }
  if (!items.length) return '';
  var seen = {}, uniq = items.filter(function(x){ var k = x.name.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
  var top = uniq.slice().sort(function(a, b){ return b.v - a.v; }).slice(0, 3).sort(function(a, b){ return a.i - b.i; });
  return top.map(function(x){ return x.name; }).join(', ');
}

// ---------- Kategorie ----------
function suggestCat(text, shop, ctx){
  var cats = ctx.cats || [], T = fold(text);
  var scores = {}, add = function(k, w){ scores[k] = (scores[k] || 0) + w; };
  var learned = null;
  if (shop.name && ctx.memory){
    var mem = ctx.memory[shop.name.toLowerCase()];
    if (mem && cats.some(function(c){ return c.id === mem; })) learned = mem;
  }
  if (learned) return { id: learned, conf: 0.92, why: 'gelernt' };
  if (shop.chain) add(shop.chain.kind, 3 * shop.chain.w);
  Object.keys(KIND_WORDS).forEach(function(k){
    var re = KIND_WORDS[k], g = new RegExp(re.source, 'gi'), n = 0;
    while (g.exec(T) && n < 4) n++;
    if (n) add(k, Math.min(n, 3) * (k === 'fuel' ? 1.5 : 1));
  });
  var best = null;
  Object.keys(scores).forEach(function(k){ if (!best || scores[k] > scores[best]) best = k; });
  if (!best) return { id: null, conf: 0 };
  var id = kindToCat(best, cats) || (best !== 'misc' ? null : null);
  if (!id) return { id: null, conf: 0 };
  var strong = shop.chain && shop.chain.kind === best && shop.chain.w >= 0.7;
  var conf = strong ? (scores[best] >= 4.5 ? 0.9 : 0.8) : scores[best] >= 3 ? 0.6 : 0.45;
  if (best === 'misc') conf = Math.min(conf, 0.5);
  return { id: id, conf: conf, kind: best };
}

// ---------- Hauptfunktion ----------
function parse(text, ctx){
  ctx = ctx || {};
  var now = ctx.now || new Date();
  var raw = String(text || '').replace(/\r/g, '').replace(/[\u00a0\u202f\u2009]/g, ' ');
  var lines = raw.split('\n').map(function(l){ return l.replace(/\s+$/, ''); });
  var nonEmpty = lines.filter(function(l){ return l.trim(); });
  if (nonEmpty.join('').replace(/\s/g, '').length < 8) return { empty: true, amount: null, amountConf: 0, shop: '', shopConf: 0, date: null, dateConf: 0, catId: null, catConf: 0, note: '' };
  var am = findAmount(lines), dt = findDate(lines, now), sh = findShop(lines), note = findNote(lines);
  var cat = suggestCat(raw, sh, ctx);
  return { empty: false, amount: am.v, amountConf: am.conf, shop: sh.name, shopConf: sh.conf,
    date: dt ? { y: dt.y, m: dt.m, d: dt.d, h: dt.h, mi: dt.mi } : null, dateConf: dt ? dt.conf : 0,
    catId: cat.id, catConf: cat.conf, catKind: cat.kind || null, note: note };
}

var api = { parse: parse, findAmount: function(t){ return findAmount(String(t).split('\n')); }, findDate: findDate, findShop: findShop, findNote: findNote, moneyTokens: moneyTokens, kindToCat: kindToCat, fold: fold };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.BelegParser = api;
})(typeof self !== 'undefined' ? self : this);
