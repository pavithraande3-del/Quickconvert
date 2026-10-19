/* QuickConvert — vanilla JS.
   Sections: 1) CSV currency list  2) flags  3) rates API  4) dropdown  5) conversion UI */

const CSV_URL = "all_195_countries_currencies.csv";   // must sit next to index.html

/* ========== 1) CSV → CURRENCY LIST ========== */
// Small CSV parser (handles quotes, commas inside quotes, CRLF line endings, BOM)
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = []; let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

// Rows like "India","Indian Rupee (INR)" → one entry per ISO code, keeping every country that uses it
function buildCurrencies(rows) {
  const head = rows[0].map(h => h.trim().toLowerCase());
  const ci = head.indexOf("country"), ui = head.indexOf("currency");
  if (ci < 0 || ui < 0) throw new Error("CSV needs 'Country' and 'Currency' columns");
  const map = new Map(); let skipped = 0;
  for (const r of rows.slice(1)) {
    const country = (r[ci] || "").trim();
    const m = (r[ui] || "").trim().match(/^(.*?)\s*\(([A-Za-z]{3})\)\s*$/);
    if (!country || !m) { skipped++; continue; }       // never guess a missing code
    const code = m[2].toUpperCase();
    if (!map.has(code)) map.set(code, { code, name: m[1] || code, countries: [] });
    const c = map.get(code);
    if (!c.countries.includes(country)) c.countries.push(country);
  }
  if (skipped) console.warn(`QuickConvert: ${skipped} CSV row(s) skipped (no ISO code found).`);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

let CURRENCIES = [];
const byCode = code => CURRENCIES.find(c => c.code === code);

/* ========== 2) FLAGS (display only; the CSV has no flag data) ========== */
const GLOBE = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0f6b45" stroke-width="1.6"><circle cx="12" cy="12" r="10" fill="#e4f2ea"/><path d="M2 12h20M12 2c3 3 4.5 6.5 4.5 10S15 19 12 22C9 19 7.5 15.5 7.5 12S9 5 12 2z"/></svg>');
// Currencies shared by many countries get one representative flag; other shared ones (XCD, XOF, XAF) get the globe
const SHARED_FLAGS = { EUR: "eu", USD: "us", AUD: "au", CHF: "ch", ILS: "il" };
// Country name (exactly as written in the CSV) → ISO-2 code, used ONLY to pick a flag image
const COUNTRY_ISO = Object.fromEntries(`Afghanistan=af;Albania=al;Algeria=dz;Angola=ao;Argentina=ar;Armenia=am;Azerbaijan=az;Bahamas=bs;Bahrain=bh;Bangladesh=bd;Barbados=bb;Belarus=by;Belize=bz;Bhutan=bt;Bolivia=bo;Bosnia and Herzegovina=ba;Botswana=bw;Brazil=br;Brunei=bn;Bulgaria=bg;Burundi=bi;Cabo Verde=cv;Cambodia=kh;Canada=ca;Chile=cl;China=cn;Colombia=co;Comoros=km;Costa Rica=cr;Cuba=cu;Czechia (Czech Republic)=cz;Democratic Republic of the Congo=cd;Denmark=dk;Djibouti=dj;Dominican Republic=do;Egypt=eg;Eritrea=er;Eswatini=sz;Ethiopia=et;Fiji=fj;Gambia=gm;Georgia=ge;Ghana=gh;Guatemala=gt;Guinea=gn;Guyana=gy;Haiti=ht;Honduras=hn;Hungary=hu;Iceland=is;India=in;Indonesia=id;Iran=ir;Iraq=iq;Jamaica=jm;Japan=jp;Jordan=jo;Kazakhstan=kz;Kenya=ke;Kuwait=kw;Kyrgyzstan=kg;Laos=la;Lebanon=lb;Lesotho=ls;Liberia=lr;Libya=ly;Madagascar=mg;Malawi=mw;Malaysia=my;Maldives=mv;Mauritania=mr;Mauritius=mu;Mexico=mx;Moldova=md;Mongolia=mn;Morocco=ma;Mozambique=mz;Myanmar (Burma)=mm;Namibia=na;Nepal=np;New Zealand=nz;Nicaragua=ni;Nigeria=ng;North Korea=kp;North Macedonia=mk;Norway=no;Oman=om;Pakistan=pk;Panama=pa;Papua New Guinea=pg;Paraguay=py;Peru=pe;Philippines=ph;Poland=pl;Qatar=qa;Romania=ro;Russia=ru;Rwanda=rw;Samoa=ws;Sao Tome and Principe=st;Saudi Arabia=sa;Serbia=rs;Seychelles=sc;Sierra Leone=sl;Singapore=sg;Solomon Islands=sb;Somalia=so;South Africa=za;South Korea=kr;South Sudan=ss;Sri Lanka=lk;Sudan=sd;Suriname=sr;Sweden=se;Syria=sy;Tajikistan=tj;Tanzania=tz;Thailand=th;Tonga=to;Trinidad and Tobago=tt;Tunisia=tn;Turkey=tr;Turkmenistan=tm;Uganda=ug;Ukraine=ua;United Arab Emirates=ae;United Kingdom=gb;United States of America=us;Uruguay=uy;Uzbekistan=uz;Vanuatu=vu;Venezuela=ve;Vietnam=vn;Yemen=ye;Zambia=zm;Zimbabwe=zw`.split(";").map(s => s.split("=")));
function flagUrl(c) {
  const cc = SHARED_FLAGS[c.code] || (c.countries.length === 1 ? COUNTRY_ISO[c.countries[0]] : null);
  return cc ? `https://flagcdn.com/w40/${cc}.png` : GLOBE;
}
const countriesText = c => c.countries.length <= 3 ? c.countries.join(", ") : `${c.countries.slice(0, 3).join(", ")} +${c.countries.length - 3} more`;

/* ========== 3) RATES API (change providers here only) ========== */
const API_URLS = base => [
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${base}.json`,
  `https://latest.currency-api.pages.dev/v1/currencies/${base}.json` // fallback mirror
];
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();     // base code -> { rates, date, fetchedAt }
const pending = new Map();   // base code -> in-flight request (prevents duplicate requests)
let supported = null;        // Set of codes the provider has a rate for (null = not known yet)

async function loadRates(base, force = false) {
  const key = base.toLowerCase();
  const hit = cache.get(key);
  if (hit && !force && Date.now() - hit.fetchedAt < CACHE_MS) return hit;
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    let lastErr;
    for (const url of API_URLS(key)) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        if (!data || typeof data.date !== "string" || !data[key] || typeof data[key] !== "object") throw new Error("Unexpected response format");
        const entry = { rates: data[key], date: data.date, fetchedAt: Date.now() };
        cache.set(key, entry);
        return entry;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("Network error");
  })().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
const validRate = r => typeof r === "number" && isFinite(r) && r > 0;

// Learn which currencies the provider really supports (from one rate table), so the UI can mark the rest
async function detectSupported(base) {
  try {
    const t = await loadRates(base);
    supported = new Set(Object.keys(t.rates).filter(k => validRate(t.rates[k])).map(k => k.toUpperCase()));
    supported.add(base);
  } catch { supported = null; }
}

class RateError extends Error { constructor(kind, code) { super(kind); this.kind = kind; this.code = code; } }

async function getRate(from, to, force = false) {
  if (from === to) return { rate: 1, date: null, fetchedAt: Date.now() };
  if (supported) for (const c of [from, to]) if (!supported.has(c)) throw new RateError("UNSUPPORTED", c);
  const t = await loadRates(from, force);
  const rate = t.rates[to.toLowerCase()];
  if (!validRate(rate)) throw new RateError("UNSUPPORTED", to);
  return { rate, date: t.date, fetchedAt: t.fetchedAt };
}

/* ========== 4) SEARCHABLE CURRENCY DROPDOWN ========== */
function createCombo(root, label, initial, onChange) {
  let value = initial;
  root.innerHTML = `<button type="button" class="combo-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="${label}"><img alt=""><span></span></button>
    <div class="pop" hidden><input type="search" placeholder="Search currency or country…" aria-label="Search currencies or countries"><ul role="listbox" aria-label="${label}"></ul></div>`;
  const btn = root.querySelector(".combo-btn"), pop = root.querySelector(".pop");
  const search = pop.querySelector("input"), list = pop.querySelector("ul");
  const esc = s => s.replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

  // If a flag image fails to load, show the globe instead
  root.addEventListener("error", e => { if (e.target.tagName === "IMG" && e.target.src !== GLOBE) e.target.src = GLOBE; }, true);

  function paintButton() {
    const c = byCode(value);
    btn.querySelector("img").src = flagUrl(c);
    btn.querySelector("span").textContent = c.code;
  }
  function render(filter = "") {
    const q = filter.trim().toLowerCase();
    const items = CURRENCIES.filter(c => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.countries.some(n => n.toLowerCase().includes(q)));
    list.innerHTML = items.length ? "" : `<li class="none">No match</li>`;
    items.forEach(c => {
      const li = document.createElement("li");
      const noRate = supported && !supported.has(c.code);
      li.innerHTML = `<button type="button" role="option" aria-selected="${c.code === value}" data-code="${c.code}"${noRate ? ' class="norate"' : ""}>
        <img src="${flagUrl(c)}" alt="" loading="lazy"><b>${c.code}</b>
        <span class="nm">${esc(c.name)}<small>${esc(countriesText(c))}</small></span>${noRate ? '<i class="tag">No rate</i>' : ""}</button>`;
      list.appendChild(li);
    });
  }
  function open() { render(); pop.hidden = false; btn.setAttribute("aria-expanded", "true"); search.value = ""; search.focus(); }
  function close(focusBtn = true) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); if (focusBtn) btn.focus(); }
  function choose(code) { value = code; paintButton(); close(); onChange(code); }

  btn.addEventListener("click", () => pop.hidden ? open() : close());
  search.addEventListener("input", () => render(search.value));
  search.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); const f = list.querySelector("button"); if (f) choose(f.dataset.code); }
    if (e.key === "ArrowDown") { e.preventDefault(); list.querySelector("button")?.focus(); }
  });
  list.addEventListener("click", e => { const b = e.target.closest("button"); if (b) choose(b.dataset.code); });
  list.addEventListener("keydown", e => {
    const li = document.activeElement.closest("li");
    if (e.key === "ArrowDown" && li?.nextElementSibling) { e.preventDefault(); li.nextElementSibling.querySelector("button")?.focus(); }
    if (e.key === "ArrowUp" && li) { e.preventDefault(); (li.previousElementSibling?.querySelector("button") || search).focus(); }
  });
  root.addEventListener("keydown", e => { if (e.key === "Escape" && !pop.hidden) close(); });
  document.addEventListener("click", e => { if (!root.contains(e.target) && !pop.hidden) close(false); });

  paintButton();
  return { get: () => value, set: code => { value = code; paintButton(); } };
}

/* ========== 5) CONVERSION UI ========== */
const $ = id => document.getElementById(id);
const amountEl = $("amount"), resultEl = $("result"), statusEl = $("status"), convertBtn = $("convert");
let fromCombo, toCombo, lastKey = "";

function showStatus(msg, type = "info", retryFn = null) {
  statusEl.hidden = false;
  statusEl.className = "status" + (type === "error" ? " error" : "");
  statusEl.textContent = msg;
  if (retryFn) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = "Retry";
    b.addEventListener("click", retryFn);
    statusEl.appendChild(b);
  }
}
const hideStatus = () => { statusEl.hidden = true; };

function parseAmount(text) {
  const t = text.trim().replace(/,/g, "");
  if (t === "") throw new Error("Please enter an amount.");
  if (!/^-?\d*\.?\d+$/.test(t)) throw new Error("Please enter a valid number (digits only, e.g. 1000 or 12.50).");
  const n = Number(t);
  if (n < 0) throw new Error("Amount cannot be negative.");
  if (!isFinite(n)) throw new Error("That number is too large.");
  return n;
}
function money(n, code) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: code, ...(n < 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 4 } : {}) }).format(n); }
  catch { return n.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + code; }
}

async function convert(force = false) {
  if (!fromCombo) return;
  let amount;
  try { amount = parseAmount(amountEl.value); }
  catch (e) { showStatus(e.message, "error"); amountEl.focus(); return; }

  const from = fromCombo.get(), to = toCombo.get();
  const key = `${amount}|${from}|${to}`;
  if (!force && key === lastKey) return;   // nothing changed, skip the work

  convertBtn.disabled = true;
  showStatus("Fetching the latest available rate…");
  try {
    const { rate, date, fetchedAt } = await getRate(from, to, force);
    const converted = amount * rate;                  // the core formula
    resultEl.value = converted.toLocaleString(undefined, { maximumFractionDigits: converted < 1 ? 4 : 2 });
    $("outAmount").textContent = money(converted, to);
    $("outRate").textContent = `1 ${from} = ${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 5 }).format(rate)} ${to}`;
    $("outSource").textContent = from === to ? "(Same currency)" : "(Reference rate, not a live trading rate)";
    $("outTime").textContent = date ? `Rate date (from provider): ${date} · Checked: ${new Date(fetchedAt).toLocaleString()}` : "";
    lastKey = key;
    hideStatus();
  } catch (e) {
    lastKey = "";
    resultEl.value = ""; $("outAmount").textContent = "—";
    $("outRate").textContent = "Rate unavailable"; $("outTime").textContent = "";
    if (e instanceof RateError) {
      const c = byCode(e.code);
      showStatus(`No exchange rate is available for ${c ? c.name + " (" + c.code + ")" : e.code} from our data provider, so this conversion can't be shown. Please choose another currency.`, "error");
    } else showStatus("The latest rate could not be retrieved. Check your internet connection and try again.", "error", () => convert(true));
  } finally { convertBtn.disabled = false; }
}

$("swap").addEventListener("click", () => {
  if (!fromCombo) return;
  const a = fromCombo.get(), b = toCombo.get();
  fromCombo.set(b); toCombo.set(a);
  convert();
});
convertBtn.addEventListener("click", () => convert());
amountEl.addEventListener("keydown", e => { if (e.key === "Enter") convert(); });

// Start-up: load CSV → build dropdowns → learn supported currencies → first conversion
async function init() {
  convertBtn.disabled = true;
  showStatus("Loading currency list…");
  try {
    const res = await fetch(CSV_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    CURRENCIES = buildCurrencies(parseCSV(await res.text()));
    if (!CURRENCIES.length) throw new Error("No currencies found in the CSV");
  } catch (e) {
    showStatus("Could not load the currency list (all_195_countries_currencies.csv). Keep it in the same folder as index.html and open the site through VS Code Live Server, not by double-clicking the file.", "error", init);
    return;
  }
  const pick = (code, i) => byCode(code) ? code : CURRENCIES[i].code;     // defaults: INR → USD
  fromCombo = createCombo($("fromCombo"), "Source currency", pick("INR", 0), () => {});
  toCombo = createCombo($("toCombo"), "Target currency", pick("USD", Math.min(1, CURRENCIES.length - 1)), () => {});
  await detectSupported(fromCombo.get());
  convertBtn.disabled = false;
  convert();
}
init();