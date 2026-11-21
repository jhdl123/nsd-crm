"use strict";
/* Next Step CRM — vanilla JS app on Supabase.
   Data model: companies with optional lead / partner / client roles, contacts, deals (+ invoices),
   activities, tasks, projects, content, channels, day blocks. Dropdowns come from the `options` table. */

const CFG = window.NSD_CONFIG;
const SB = window.__MOCK_SB || supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "nsd-crm-auth" },
});

/* ---------- utilities ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const localISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => localISO(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return localISO(d); };
const dayDiff = (iso) => { if (!iso) return null; return Math.round((new Date(String(iso).slice(0, 10) + "T12:00:00") - new Date(today() + "T12:00:00")) / 86400000); };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => { if (!iso) return ""; const d = new Date(String(iso).slice(0, 10) + "T12:00:00"); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
const fmtTime = (iso) => (iso && String(iso).length > 10 ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
const rel = (iso) => { const n = dayDiff(iso); if (n === null) return ""; if (n === 0) return "today"; if (n === 1) return "tomorrow"; if (n === -1) return "yesterday"; if (n < 0) return `${-n}d ago`; if (n < 7) return DOW[new Date(String(iso).slice(0, 10) + "T12:00:00").getDay()]; return fmtDate(iso); };
const whenCls = (iso) => { const n = dayDiff(iso); return n === null ? "" : n < 0 ? "over" : n === 0 ? "today" : ""; };
const money = (n, cur = "GBP") => (n == null || n === "" || isNaN(n) ? "" : (cur === "EUR" ? "€" : cur === "USD" ? "$" : "£") + Number(n).toLocaleString("en-GB", { maximumFractionDigits: 0 }));
const mdText = (s) => esc(s || "").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_, t, h) => `<a href="${h}" target="_blank" rel="noopener">${t}</a>`);
const plainLink = (s) => { if (!s) return { text: "", href: "" }; const m = String(s).match(/\[([^\]]+)\]\(([^)]+)\)/); if (m) return { text: m[1], href: m[2] }; const t = String(s).trim(); return { text: t.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: /^https?:/.test(t) ? t : "https://" + t }; };
const get = (o, path) => path.split(".").reduce((x, p) => (x == null ? x : x[p]), o);
const live = (r) => !r.archived_at;

/* ---------- state ---------- */
const TABLES = ["options", "companies", "contacts", "lead_details", "partner_details", "client_details", "deals", "invoices", "activities", "tasks", "projects", "content", "content_channels", "channels", "day_blocks"];
const T = {}; // raw rows per table
const X = { co: new Map(), contact: new Map(), deal: new Map(), inv: new Map(), task: new Map(), act: new Map(), proj: new Map(), content: new Map(), chan: new Map(), block: new Map() };
let OPT = {};
const S = {
  view: "today", user: null, loaded: false, fresh: null, offline: !navigator.onLine,
  board: "leads", showClosed: false, ctab: "leads", cq: "", csort: "next", tq: "", tshowDone: false,
  weekStart: null, drawer: null, form: null, openPick: null, filters: {},
};
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
Object.assign(S, LS.get("nsd-crm-ui", {}), { view: S.view, drawer: null, form: null });
S.filters = LS.get("nsd-crm-filters2", {});
const persistUi = () => LS.set("nsd-crm-ui", { board: S.board, ctab: S.ctab, csort: S.csort });
const persistFilters = () => LS.set("nsd-crm-filters2", S.filters);

/* ---------- field definitions ---------- */
// t text, ta long text, e email, p phone, u url, d date, dt date+time, tm time, n number, c checkbox, s select, m multi-select
const F = (k, t, label, opt) => ({ k, t, label: label || k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), opt });
const FIELDS = {
  company: [F("website", "t"), F("email", "e"), F("phone", "p"), F("location", "t"), F("niche", "t"), F("business_type", "s", "Business type", "business_type"), F("fit", "s", "Fit", "fit"), F("source", "s", "Source", "source"), F("last_contacted", "d"), F("notes", "ta"), F("body", "ta", "Page notes")],
  lead: [F("stage", "s", "Lead stage", "lead_stage"), F("first_contact", "d"), F("audit_due", "d"), F("observation", "ta"), F("pilot_candidate", "c"), F("social_platform", "s", "Social platform", "social_platform"), F("social_follow_up", "s", "Social follow-up", "social_follow_up"), F("social_sent", "d"), F("social_outcome", "t"), F("utm_source", "t", "UTM source"), F("utm_medium", "t", "UTM medium"), F("utm_campaign", "t", "UTM campaign"), F("utm_content", "t", "UTM content")],
  partner: [F("stage", "s", "Partner stage", "partner_stage"), F("partner_type", "s", "Partner type", "partner_type"), F("contact_route", "t"), F("team", "t"), F("what_they_offer", "ta"), F("why_they_fit", "ta"), F("suggested_angle", "ta"), F("gaps_to_check", "ta"), F("referrals_sent", "n"), F("referrals_received", "n"), F("date_added", "d"), F("source_note", "t", "Source note")],
  client: [F("stage", "s", "Client stage", "client_stage"), F("services", "m", "Services", "services"), F("monthly_value", "n", "Monthly value (£)"), F("start_date", "d"), F("review_date", "d", "Review / renewal date"), F("pilot_client", "c"), F("testimonial", "s", "Testimonial", "testimonial"), F("case_study_ok", "s", "Case study OK", "case_study_ok")],
  contact: [F("role", "t"), F("email", "e"), F("phone", "p"), F("linkedin", "u", "LinkedIn"), F("is_primary", "c", "Primary contact"), F("met_in_person", "c"), F("event", "t"), F("notes", "ta")],
  deal: [F("stage", "s", "Stage", "deal_stage"), F("offer", "s", "Offer", "offer"), F("value", "n"), F("currency", "t"), F("billing_period", "s", "Billing", "billing_period"), F("expected_close", "d"), F("closed_date", "d"), F("recurring", "c"), F("pilot_pricing", "c"), F("notes", "ta")],
  invoice: [F("status", "s", "Status", "invoice_status"), F("number", "t"), F("amount", "n"), F("currency", "t"), F("issue_date", "d"), F("due_date", "d"), F("paid_date", "d"), F("notes", "ta")],
  task: [F("status", "s", "Status", "task_status"), F("due_date", "d", "Due"), F("due_time", "tm", "Time"), F("priority", "s", "Priority", "priority"), F("type", "s", "Type", "task_type"), F("estimate_mins", "n", "Estimate (mins)"), F("recurrence", "s", "Repeats", "recurrence"), F("done_on", "d"), F("notes", "ta"), F("body", "ta", "Page notes")],
  act: [F("type", "s", "Type", "activity_type"), F("outcome", "s", "Outcome", "outcome"), F("occurred_on", "d", "Date"), F("link", "u"), F("post_angle", "t"), F("body", "ta", "Notes")],
  content: [F("status", "s", "Status", "content_status"), F("format", "s", "Format", "content_format"), F("publish_date", "d"), F("target_keyword", "t"), F("link", "u"), F("utm_content", "t", "UTM content"), F("brief", "ta"), F("body", "ta", "Page notes")],
  project: [F("status", "s", "Status", "project_status"), F("type", "s", "Type", "project_type"), F("priority", "s", "Priority", "priority"), F("start_date", "d"), F("end_date", "d"), F("budget", "n"), F("utm_campaign", "t", "UTM campaign"), F("goal", "ta"), F("body", "ta", "Page notes")],
  block: [F("status", "s", "Status", "block_status"), F("focus", "s", "Focus", "focus"), F("starts_at", "dt", "Starts"), F("ends_at", "dt", "Ends"), F("output", "t"), F("notes", "ta")],
};
const KIND = {
  company: { table: "companies", title: "name", label: "Company", map: "co" },
  contact: { table: "contacts", title: "name", label: "Person", map: "contact" },
  deal: { table: "deals", title: "title", label: "Deal", map: "deal" },
  invoice: { table: "invoices", title: "number", label: "Invoice", map: "inv" },
  task: { table: "tasks", title: "title", label: "Task", map: "task" },
  act: { table: "activities", title: "subject", label: "Activity", map: "act" },
  content: { table: "content", title: "title", label: "Content", map: "content" },
  project: { table: "projects", title: "name", label: "Project", map: "proj" },
  block: { table: "day_blocks", title: "title", label: "Day block", map: "block" },
};
const ROLE = {
  lead: { table: "lead_details", label: "Lead", closed: ["Won", "Lost", "Nurture"], opt: "lead_stage", start: "New" },
  partner: { table: "partner_details", label: "Partner", closed: ["Not a fit", "On hold"], opt: "partner_stage", start: "To verify" },
  client: { table: "client_details", label: "Client", closed: ["Completed", "Churned"], opt: "client_stage", start: "Onboarding" },
};
const optColor = (field, v) => (OPT[field] || []).find((o) => o.n === v)?.c || "gray";
const chip = (field, v) => (v ? `<span class="chip c-${optColor(field, v)}">${esc(v)}</span>` : "");
const nameOf = (kind, r) => (r ? r[KIND[kind].title] || "Untitled" : "");
const ICON = {
  today: '<path d="M3 9h18M7 3v4M17 3v4"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="m9 15 2 2 4-4"/>',
  pipeline: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/>',
  contacts: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.6 2.5 3 5.2"/>',
  tasks: '<path d="m4 6 2 2 3-3M4 13l2 2 3-3M4 20h.01"/><path d="M12 7h8M12 14h8M12 20h8"/>',
  planner: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>',
};
const VIEWS = [["today", "Today"], ["pipeline", "Pipeline"], ["contacts", "Contacts"], ["tasks", "Tasks"], ["planner", "Planner"]];

/* ---------- loading ---------- */
async function fetchTable(t) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await SB.from(t).select("*").range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  T[t] = all;
}
async function loadAll() {
  try {
    await Promise.all(TABLES.map(fetchTable));
    S.fresh = Date.now(); S.loadError = null;
    LS.set("nsd-crm-cache", { at: S.fresh, T });
  } catch (e) {
    S.loadError = e.message || String(e);
  }
  index(); S.loaded = true; render(); refreshDrawer();
}
let reloadTimers = {};
function reloadTable(t) {
  clearTimeout(reloadTimers[t]);
  reloadTimers[t] = setTimeout(async () => {
    try { await fetchTable(t); S.fresh = Date.now(); LS.set("nsd-crm-cache", { at: S.fresh, T }); index(); render(); refreshDrawer(); } catch {}
  }, 300);
}
function index() {
  OPT = {};
  for (const o of (T.options || []).filter((o) => o.active).sort((a, b) => a.sort - b.sort)) (OPT[o.field] ||= []).push({ n: o.value, c: o.colour });
  const by = (arr) => new Map((arr || []).filter(live).map((r) => [r.id, r]));
  X.co = by(T.companies); X.contact = by(T.contacts); X.deal = by(T.deals); X.inv = by(T.invoices); X.task = by(T.tasks);
  X.act = by(T.activities); X.proj = by(T.projects); X.content = by(T.content); X.chan = by(T.channels); X.block = by(T.day_blocks);
  for (const c of X.co.values()) Object.assign(c, { lead: null, partner: null, client: null, people: [], tasks: [], acts: [], deals: [] });
  for (const [role, cfg] of Object.entries(ROLE)) for (const d of T[cfg.table] || []) { const c = X.co.get(d.company_id); if (c) c[role] = d; }
  for (const p of X.contact.values()) { const c = X.co.get(p.company_id); if (c) c.people.push(p); }
  for (const t of X.task.values()) { const c = X.co.get(t.company_id); if (c) c.tasks.push(t); }
  for (const a of X.act.values()) { const c = X.co.get(a.company_id); if (c) c.acts.push(a); }
  for (const d of X.deal.values()) { d.invoices = []; const c = X.co.get(d.company_id); if (c) c.deals.push(d); }
  for (const i of X.inv.values()) { const d = X.deal.get(i.deal_id); if (d) d.invoices.push(i); }
  for (const c of X.co.values()) {
    c.people.sort((a, b) => b.is_primary - a.is_primary);
    c.acts.sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)) || String(b.created_at).localeCompare(String(a.created_at)));
    c.next = c.tasks.filter((t) => t.status !== "Done").sort((a, b) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")))[0] || null;
    c.primary = c.people[0] || null;
  }
}
function realtime() {
  if (!SB.channel) return;
  SB.channel("crm-all").on("postgres_changes", { event: "*", schema: "public" }, (p) => { if (TABLES.includes(p.table)) reloadTable(p.table); }).subscribe();
}

/* ---------- writing ---------- */
function toast(msg, bad) { clearTimeout(toast.t); $("#toastbox").innerHTML = `<div class="toast ${bad ? "bad" : ""}" role="status">${esc(msg)}</div>`; toast.t = setTimeout(() => { $("#toastbox").innerHTML = ""; }, bad ? 7000 : 2000); }
const errMsg = (e) => (navigator.onLine ? `Couldn't save: ${e.message || e}` : "You're offline, so that change wasn't saved. Try again when you're back online.");
async function update(table, keyCol, id, patch, local) {
  const before = local ? Object.fromEntries(Object.keys(patch).map((k) => [k, local[k]])) : null;
  if (local) Object.assign(local, patch);
  render();
  const { error } = await SB.from(table).update(patch).eq(keyCol, id);
  if (error) { if (local) Object.assign(local, before); toast(errMsg(error), true); render(); refreshDrawer(); return false; }
  toast("Saved"); reloadTable(table); return true;
}
async function insert(table, row) {
  const { data, error } = await SB.from(table).insert(row).select().single();
  if (error) { toast(errMsg(error), true); return null; }
  (T[table] ||= []).push(data); index(); render(); reloadTable(table); return data;
}
const tableFor = (kind) => KIND[kind].table;
async function saveField(kind, rec, section, k, v) {
  if (section && ROLE[section]) return update(ROLE[section].table, "company_id", rec.id, { [k]: v }, rec[section]);
  if (kind === "company" || !section) return update(tableFor(kind), "id", rec.id, { [k]: v }, rec);
}

/* ---------- derived ---------- */
const openTasks = () => [...X.task.values()].filter((t) => t.status !== "Done");
const linkOf = (t) => (t.company_id && X.co.get(t.company_id)) ? ["company", X.co.get(t.company_id)] : (t.deal_id && X.deal.get(t.deal_id)) ? ["deal", X.deal.get(t.deal_id)] : (t.project_id && X.proj.get(t.project_id)) ? ["project", X.proj.get(t.project_id)] : (t.content_id && X.content.get(t.content_id)) ? ["content", X.content.get(t.content_id)] : null;
const linkName = (t) => { const l = linkOf(t); return l ? nameOf(l[0], l[1]) : ""; };
function attention() {
  const t = today(), items = [];
  for (const x of openTasks()) if (x.due_date && x.due_date <= t) items.push({ type: "task", rec: x, date: x.due_date });
  for (const c of X.co.values()) {
    if (c.lead?.stage === "Audit requested" && c.lead.audit_due && c.lead.audit_due <= addDays(t, 1)) items.push({ type: "audit", rec: c, date: c.lead.audit_due });
    if (c.client && c.client.review_date && ["Active", "Onboarding"].includes(c.client.stage) && dayDiff(c.client.review_date) <= 14 && dayDiff(c.client.review_date) >= -30) items.push({ type: "renewal", rec: c, date: c.client.review_date });
  }
  for (const i of X.inv.values()) if (i.status === "Overdue" || (i.status === "Sent" && i.due_date && i.due_date < t)) items.push({ type: "invoice", rec: i, date: i.due_date || t });
  return items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
function upcoming() {
  const t = today(), end = addDays(t, 7), items = [];
  for (const x of openTasks()) if (x.due_date && x.due_date > t && x.due_date <= end) items.push({ type: "task", rec: x, date: x.due_date });
  for (const c of X.content.values()) if (c.publish_date && c.publish_date >= t && c.publish_date <= end && c.status !== "Published") items.push({ type: "content", rec: c, date: c.publish_date });
  return items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}
function goneQuiet() {
  const active = ["Contacted", "Replied", "Audit delivered", "Call booked", "Proposal sent"];
  return [...X.co.values()].filter((c) => c.lead && active.includes(c.lead.stage) && !c.next && (!c.last_contacted || dayDiff(c.last_contacted) <= -10))
    .sort((a, b) => String(a.last_contacted || "").localeCompare(String(b.last_contacted || "")));
}

/* ---------- shell ---------- */
function navHtml() {
  const n = S.loaded ? attention().length : 0;
  return VIEWS.map(([k, l]) => `<a href="#${k}" ${S.view === k ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg><span>${l}</span>${k === "today" && n ? `<span class="count">${n}</span>` : ""}</a>`).join("");
}
function syncHtml() {
  const mins = S.fresh ? Math.round((Date.now() - S.fresh) / 60000) : null;
  const label = S.offline ? "Offline: showing saved copy" : !S.fresh ? "Loading…" : mins < 1 ? "Up to date" : `Updated ${mins} min ago`;
  return `<span>${label}</span><button class="btn sm" type="button" data-act="refresh">Refresh</button><span style="font-size:12px">${esc(S.user?.email || "")}</span><button class="btn sm ghost" type="button" data-act="signout">Sign out</button>`;
}
let focusMemo = null;
function render() {
  if (!S.user) return;
  const a = document.activeElement;
  focusMemo = a && a.id && $("#view").contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  $("#nav").innerHTML = navHtml(); $("#mobnav").innerHTML = navHtml(); $("#sync").innerHTML = syncHtml();
  $("#vtitle").textContent = (VIEWS.find((v) => v[0] === S.view) || [, ""])[1];
  const fn = { today: vToday, pipeline: vPipeline, contacts: vContacts, tasks: vTasks, planner: vPlanner }[S.view] || vToday;
  const banner = S.loadError ? `<div class="banner bad">Couldn't load everything: ${esc(S.loadError)}. <button class="btn sm" data-act="refresh" type="button">Try again</button></div>` : S.offline ? `<div class="banner">You're offline. You're seeing the last saved copy; changes won't save until you're back online.</div>` : "";
  $("#view").innerHTML = banner + (S.loaded ? fn() : `<div class="panel">${skel(8)}</div>`);
  if (focusMemo) { const el = document.getElementById(focusMemo.id); if (el) { el.focus(); try { el.setSelectionRange(focusMemo.s, focusMemo.e); } catch {} } }
}
const skel = (n = 4) => Array.from({ length: n }, () => '<div class="skel"></div>').join("");
const checkBtn = (t) => { const on = t.status === "Done"; return `<button class="check ${on ? "on" : ""}" type="button" data-toggle="${t.id}" aria-label="${on ? "Mark not done" : "Mark done"}: ${esc(t.title)}" aria-pressed="${on}">${on ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 5 5 9-10"/></svg>' : ""}</button>`; };
const openAttr = (kind, id) => `data-open="${kind}:${id}"`;
function roleChips(c) {
  return ["lead", "partner", "client"].filter((r) => c[r]).map((r) => `<span class="chip c-${optColor(ROLE[r].opt, c[r].stage)}" title="${ROLE[r].label}">${ROLE[r].label}${c[r].stage ? ": " + esc(c[r].stage) : ""}</span>`).join(" ");
}
function taskRow(t) {
  const l = linkOf(t), d = t.due_date;
  return `<div class="row"><span class="stripe ${esc(t.priority || "")}"></span>${checkBtn(t)}<div class="main-t"><button class="linkish t" ${openAttr("task", t.id)} type="button" style="${t.status === "Done" ? "text-decoration:line-through;color:var(--muted)" : ""}">${esc(t.title)}</button><div class="s">${chip("task_type", t.type)} ${t.status === "In progress" ? chip("task_status", "In progress") : ""} ${t.recurrence && t.recurrence !== "None" ? `<span class="tag">↻ ${esc(t.recurrence)}</span>` : ""} ${l ? `<button class="linkish" ${openAttr(l[0], l[1].id)} type="button">${esc(nameOf(l[0], l[1]))}</button>` : ""} ${t.estimate_mins ? `<span class="when">${t.estimate_mins}m</span>` : ""}</div></div>${d ? `<span class="when ${t.status === "Done" ? "" : whenCls(d)}">${esc(rel(d))}${t.due_time ? " " + esc(String(t.due_time).slice(0, 5)) : ""}</span>` : ""}</div>`;
}

/* ---------- Today ---------- */
function attnRow(it) {
  const r = it.rec, w = `<span class="when ${whenCls(it.date)}">${esc(rel(it.date))}</span>`;
  if (it.type === "task") return taskRow(r);
  if (it.type === "invoice") { const d = X.deal.get(r.deal_id); return `<div class="row click" ${openAttr("deal", r.deal_id)}><span class="stripe High"></span><div class="main-t"><div class="t">Invoice ${esc(r.number || "")} <span class="tag">${esc(r.status)}</span></div><div class="s">${esc(nameOf("deal", d))} · ${money(r.amount, r.currency)}</div></div>${w}</div>`; }
  if (it.type === "content") return `<div class="row click" ${openAttr("content", r.id)}><span class="stripe"></span><div class="main-t"><div class="t">${esc(r.title)}</div><div class="s">${chip("content_format", r.format)} ${chip("content_status", r.status)}</div></div>${w}</div>`;
  const lab = { audit: "Audit due", renewal: "Review / renewal" }[it.type];
  return `<div class="row click" ${openAttr("company", r.id)}><span class="stripe"></span><div class="main-t"><div class="t">${esc(r.name)}</div><div class="s"><b>${lab}</b> ${esc(r.primary?.name || "")}</div></div>${w}</div>`;
}
function vToday() {
  const at = attention(), up = upcoming(), quiet = goneQuiet(), t = today();
  const openLeads = [...X.co.values()].filter((c) => c.lead && !ROLE.lead.closed.includes(c.lead.stage)).length;
  const pipe = [...X.deal.values()].filter((d) => ["Proposed", "Agreed", "Delivering"].includes(d.stage)).reduce((s, d) => s + (Number(d.value) || 0), 0);
  const acts7 = [...X.act.values()].filter((a) => a.occurred_on >= addDays(t, -6)).length;
  const blocks = [...X.block.values()].filter((b) => b.starts_at && localISO(new Date(b.starts_at)) === t).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const recent = [...X.act.values()].sort((a, b) => String(b.occurred_on).localeCompare(String(a.occurred_on)) || String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8);
  const stat = (n, l) => `<div class="stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  return `<div class="grid" style="gap:16px">
  <div class="grid stats">${stat(at.length, "Need attention now")}${stat(openLeads, "Open leads")}${stat(money(pipe) || "£0", "Open deal value")}${stat(acts7, "Touches logged, last 7 days")}</div>
  <div class="grid cols2"><div class="grid">
    <section class="panel"><h2>Overdue and due today <span class="n">${at.length}</span></h2>${at.length ? at.map(attnRow).join("") : '<div class="empty">Nothing overdue.</div>'}</section>
    <section class="panel"><h2>Next 7 days <span class="n">${up.length}</span></h2>${up.length ? up.map(attnRow).join("") : '<div class="empty">Nothing scheduled for the coming week.</div>'}</section>
    <section class="panel"><h2>Gone quiet <span class="n">${quiet.length}</span><span class="r tag">active lead, no open task, 10+ days</span></h2>${quiet.length ? quiet.slice(0, 10).map((c) => `<div class="row click" ${openAttr("company", c.id)}><span class="stripe"></span><div class="main-t"><div class="t">${esc(c.name)}</div><div class="s">${chip("lead_stage", c.lead.stage)} ${esc(c.primary?.name || "")}</div></div><span class="when">${c.last_contacted ? esc(rel(c.last_contacted)) : "never"}</span></div>`).join("") + (quiet.length > 10 ? `<div class="empty">and ${quiet.length - 10} more.</div>` : "") : '<div class="empty">Every active lead has a next step.</div>'}</section>
  </div><div class="grid">
    <section class="panel"><h2>Today's plan <span class="n">${blocks.length}</span><span class="r"><a href="#planner">Week</a></span></h2>${blocks.length ? blocks.map((b) => `<div class="row click" ${openAttr("block", b.id)}><span class="stripe"></span><div class="main-t"><div class="t">${esc(b.title)}</div><div class="s">${chip("focus", b.focus)} ${esc(b.output || "")}</div></div><span class="when">${fmtTime(b.starts_at)}</span>${chip("block_status", b.status)}</div>`).join("") : '<div class="empty">No day blocks today.</div>'}</section>
    <section class="panel"><h2>Recent activity</h2>${recent.length ? recent.map((a) => `<div class="row click" ${openAttr("act", a.id)}><span class="stripe"></span><div class="main-t"><div class="t">${esc(a.subject)}</div><div class="s">${chip("activity_type", a.type)} ${chip("outcome", a.outcome)} ${esc(X.co.get(a.company_id)?.name || "")}</div></div><span class="when">${esc(rel(a.occurred_on))}</span></div>`).join("") : '<div class="empty">No activities yet.</div>'}</section>
  </div></div></div>`;
}

/* ---------- Pipeline ---------- */
const BOARDS = {
  leads: { label: "Leads", opt: "lead_stage", closed: ROLE.lead.closed, rows: () => [...X.co.values()].filter((c) => c.lead), stage: (c) => c.lead.stage, kind: "company", set: (c, v) => update("lead_details", "company_id", c.id, { stage: v }, c.lead) },
  deals: { label: "Deals", opt: "deal_stage", closed: ["Delivered", "Lost"], rows: () => [...X.deal.values()], stage: (d) => d.stage, kind: "deal", set: (d, v) => update("deals", "id", d.id, { stage: v }, d) },
  partners: { label: "Partners", opt: "partner_stage", closed: ROLE.partner.closed, rows: () => [...X.co.values()].filter((c) => c.partner), stage: (c) => c.partner.stage, kind: "company", set: (c, v) => update("partner_details", "company_id", c.id, { stage: v }, c.partner) },
  content: { label: "Content", opt: "content_status", closed: ["Published"], rows: () => [...X.content.values()], stage: (c) => c.status, kind: "content", set: (c, v) => update("content", "id", c.id, { status: v }, c) },
};
function cardHtml(key, r) {
  let sub = "", meta = "";
  if (key === "leads") { sub = r.primary?.name || r.niche || ""; meta = `${chip("fit", r.fit)}${r.source ? `<span>${esc(r.source)}</span>` : ""}${r.next ? `<span class="when ${whenCls(r.next.due_date)}">→ ${esc(r.next.due_date ? rel(r.next.due_date) : "task")}</span>` : r.last_contacted ? `<span class="when">last ${esc(rel(r.last_contacted))}</span>` : ""}`; }
  if (key === "partners") { sub = r.location || ""; meta = `${chip("fit", r.fit)}${chip("partner_type", r.partner.partner_type)}${r.next ? `<span class="when ${whenCls(r.next.due_date)}">→ ${esc(rel(r.next.due_date) || "task")}</span>` : ""}`; }
  if (key === "deals") { sub = X.co.get(r.company_id)?.name || ""; meta = `<b style="color:var(--ink)">${money(r.value, r.currency)}${r.billing_period === "Monthly" ? "/m" : ""}</b>${chip("offer", r.offer)}${r.expected_close ? `<span class="when ${whenCls(r.expected_close)}">close ${esc(rel(r.expected_close))}</span>` : ""}`; }
  if (key === "content") { sub = r.target_keyword || ""; meta = `${chip("content_format", r.format)}${r.publish_date ? `<span class="when">${esc(fmtDate(r.publish_date))}</span>` : ""}`; }
  const b = BOARDS[key];
  return `<article class="card" draggable="true" ${openAttr(b.kind, r.id)} data-drag="${r.id}"><div class="t">${esc(nameOf(b.kind, r))}</div>${sub ? `<div class="m">${esc(sub)}</div>` : ""}<div class="m">${meta}</div></article>`;
}
function vPipeline() {
  const b = BOARDS[S.board], opts = OPT[b.opt] || [];
  const seg = Object.entries(BOARDS).map(([k, v]) => `<button type="button" data-board="${k}" aria-pressed="${S.board === k}">${v.label}</button>`).join("");
  const groups = {}; for (const o of opts) groups[o.n] = []; groups[""] = [];
  for (const r of b.rows()) (groups[b.stage(r) || ""] || groups[""]).push(r);
  for (const g of Object.values(groups)) g.sort((x, y) => String(x.next?.due_date || x.expected_close || "9").localeCompare(String(y.next?.due_date || y.expected_close || "9")));
  const cols = [...(groups[""].length ? [{ n: "", c: "gray" }] : []), ...opts].filter((o) => S.showClosed || !b.closed.includes(o.n));
  const closedSum = b.closed.map((n) => `${esc(n)} <b>${(groups[n] || []).length}</b>`).join(" · ");
  const colHtml = cols.map((o) => { const g = groups[o.n]; const v = S.board === "deals" ? money(g.reduce((s, d) => s + (Number(d.value) || 0), 0)) : "";
    return `<section class="col" data-col="${esc(o.n)}" aria-label="${esc(o.n || "No stage")}"><h3>${o.n ? chip(b.opt, o.n) : '<span class="chip">No stage</span>'}<span class="n">${g.length}</span>${v ? `<span class="v">${v}</span>` : ""}</h3><div class="cards">${g.map((r) => cardHtml(S.board, r)).join("") || '<div class="empty" style="padding:6px 4px;font-size:12.5px">Drop here</div>'}</div></section>`; }).join("");
  return `<div class="toolbar"><div class="seg">${seg}</div><span class="hide-sm" style="color:var(--muted);font-size:13px">Drag a card to change its stage, or open it.</span><span style="margin-left:auto"></span><button class="btn sm" type="button" data-act="toggleClosed">${S.showClosed ? "Hide" : "Show"} closed</button></div>${!S.showClosed ? `<div class="closedbar">Closed: ${closedSum}</div>` : ""}<div class="board">${colHtml}</div>`;
}

/* ---------- Filter builder ---------- */
const OPS = {
  t: [["contains", "contains"], ["ncontains", "does not contain"], ["is", "is exactly"], ["empty", "is empty"], ["nempty", "is not empty"]],
  s: [["any", "is any of"], ["none", "is none of"], ["empty", "is empty"], ["nempty", "is not empty"]],
  m: [["any", "has any of"], ["all", "has all of"], ["none", "has none of"], ["empty", "is empty"], ["nempty", "is not empty"]],
  d: [["today", "is today"], ["overdue", "is before today"], ["on", "is on"], ["before", "is before"], ["after", "is after"], ["last", "in the last … days"], ["next", "in the next … days"], ["older", "more than … days ago"], ["empty", "is empty"], ["nempty", "is not empty"]],
  n: [["eq", "="], ["ne", "≠"], ["gt", ">"], ["lt", "<"], ["gte", "≥"], ["lte", "≤"], ["empty", "is empty"], ["nempty", "is not empty"]],
  c: [["yes", "is ticked"], ["no", "is not ticked"]],
};
const NOVAL = new Set(["empty", "nempty", "today", "overdue", "yes", "no"]);
const simpleType = (t) => (["ta", "e", "p", "u"].includes(t) ? "t" : t === "dt" ? "d" : t === "tm" ? "t" : t);
const prefixed = (pfx, label, list) => list.filter((f) => f.k !== "body").map((f) => ({ ...f, k: pfx + f.k, label: label + f.label, t: simpleType(f.t) }));
function fieldDefs(tab) {
  const name = (k, l) => ({ k, t: "t", label: l });
  const company = [name("name", "Company name"), ...prefixed("", "", FIELDS.company), { k: "next.due_date", t: "d", label: "Next task due" }, { k: "next.title", t: "t", label: "Next task" }, { k: "primary.name", t: "t", label: "Primary contact" }];
  if (tab === "companies") return [...company, { k: "lead.stage", t: "s", opt: "lead_stage", label: "Lead stage" }, { k: "partner.stage", t: "s", opt: "partner_stage", label: "Partner stage" }, { k: "client.stage", t: "s", opt: "client_stage", label: "Client stage" }];
  if (tab === "leads") return [...company, ...prefixed("lead.", "Lead: ", FIELDS.lead)];
  if (tab === "partners") return [...company, ...prefixed("partner.", "Partner: ", FIELDS.partner)];
  if (tab === "clients") return [...company, ...prefixed("client.", "Client: ", FIELDS.client)];
  if (tab === "people") return [name("name", "Name"), ...prefixed("", "", FIELDS.contact), { k: "_company", t: "t", label: "Company" }];
  if (tab === "deals") return [name("title", "Deal"), ...prefixed("", "", FIELDS.deal), { k: "_company", t: "t", label: "Company" }];
  if (tab === "tasks") return [name("title", "Task"), ...prefixed("", "", FIELDS.task), { k: "_linked", t: "t", label: "Linked to (name)" }];
  return [];
}
const fkey = () => (S.view === "tasks" ? "tasks" : "c:" + S.ctab);
const ftab = () => (S.view === "tasks" ? "tasks" : S.ctab);
function fstate() { const k = fkey(); return (S.filters[k] ||= { mode: "all", rules: [] }); }
const ruleReady = (ru) => ru.k && ru.op && (NOVAL.has(ru.op) || (Array.isArray(ru.v) ? ru.v.length > 0 : ru.v !== "" && ru.v != null));
function fieldVal(r, k) {
  if (k === "_company") return X.co.get(r.company_id)?.name || "";
  if (k === "_linked") return linkName(r);
  return get(r, k);
}
function testRule(r, ru, def) {
  const v = fieldVal(r, ru.k), op = ru.op, want = ru.v;
  const isEmpty = (x) => x == null || x === "" || (Array.isArray(x) && !x.length);
  if (op === "empty") return isEmpty(v); if (op === "nempty") return !isEmpty(v);
  switch (def.t) {
    case "t": { const s = String(v ?? "").toLowerCase(), w = String(want).toLowerCase(); return op === "contains" ? s.includes(w) : op === "ncontains" ? !s.includes(w) : s === w; }
    case "s": return op === "any" ? want.includes(v) : !want.includes(v);
    case "m": { const a = v || []; return op === "any" ? want.some((x) => a.includes(x)) : op === "all" ? want.every((x) => a.includes(x)) : !want.some((x) => a.includes(x)); }
    case "c": return op === "yes" ? !!v : !v;
    case "n": { if (isEmpty(v)) return false; const a = Number(v), b = Number(want); return { eq: a === b, ne: a !== b, gt: a > b, lt: a < b, gte: a >= b, lte: a <= b }[op]; }
    case "d": { if (!v) return false; const d = String(v).slice(0, 10), t = today();
      return { today: d === t, overdue: d < t, on: d === want, before: d < want, after: d > want, last: d <= t && d >= addDays(t, -Number(want)), next: d >= t && d <= addDays(t, Number(want)), older: d < addDays(t, -Number(want)) }[op] ?? true; }
  }
  return true;
}
function applyFilters(list) {
  const st = fstate(), defs = fieldDefs(ftab()), rules = st.rules.filter(ruleReady);
  if (!rules.length) return list;
  return list.filter((r) => { const res = rules.map((ru) => { const d = defs.find((x) => x.k === ru.k); return d ? testRule(r, ru, d) : true; }); return st.mode === "any" ? res.some(Boolean) : res.every(Boolean); });
}
function filterBar() {
  const st = fstate(), defs = fieldDefs(ftab());
  const rows = st.rules.map((ru, i) => {
    const def = defs.find((x) => x.k === ru.k) || defs[0]; const ops = OPS[def.t] || OPS.t;
    let val = "";
    if (!NOVAL.has(ru.op)) {
      if (def.t === "s" || def.t === "m") { const sel = Array.isArray(ru.v) ? ru.v : []; const pid = `fp_${i}`;
        val = `<details class="pick" id="${pid}" ${S.openPick === pid ? "open" : ""}><summary class="field-in">${sel.length ? esc(sel.join(", ")) : "Choose…"}</summary><div class="pickbox">${(OPT[def.opt] || []).map((o) => `<label><input type="checkbox" data-fi="${i}" data-fv="${esc(o.n)}" ${sel.includes(o.n) ? "checked" : ""}> ${chip(def.opt, o.n)}</label>`).join("")}</div></details>`; }
      else if (def.t === "d" && ["last", "next", "older"].includes(ru.op)) val = `<input id="fv_${i}" data-fi="${i}" class="field-in" type="number" min="0" inputmode="numeric" value="${esc(ru.v ?? "")}" placeholder="days" style="width:90px">`;
      else if (def.t === "d") val = `<input id="fv_${i}" data-fi="${i}" class="field-in" type="date" value="${esc(ru.v ?? "")}">`;
      else if (def.t === "n") val = `<input id="fv_${i}" data-fi="${i}" class="field-in" type="number" value="${esc(ru.v ?? "")}" style="width:110px">`;
      else val = `<input id="fv_${i}" data-fi="${i}" class="field-in" type="text" value="${esc(ru.v ?? "")}" placeholder="value">`;
    }
    return `<div class="frule"><span class="fjoin">${i ? (st.mode === "any" ? "or" : "and") : "where"}</span><select id="ff_${i}" data-ff="${i}" class="field-in" aria-label="Field">${defs.map((d) => `<option value="${esc(d.k)}" ${d.k === ru.k ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</select><select id="fo_${i}" data-fo="${i}" class="field-in" aria-label="Condition">${ops.map(([k, l]) => `<option value="${k}" ${k === ru.op ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>${val}<button class="btn sm ghost" type="button" data-fdel="${i}" aria-label="Remove filter">✕</button></div>`;
  }).join("");
  const n = st.rules.filter(ruleReady).length;
  return `<div class="fbar">${rows}<div class="fctl"><button class="btn sm" type="button" data-fadd="1">+ Add filter</button>${st.rules.length > 1 ? `<label>Match <select id="fmode" class="field-in"><option value="all" ${st.mode === "all" ? "selected" : ""}>all filters</option><option value="any" ${st.mode === "any" ? "selected" : ""}>any filter</option></select></label>` : ""}${st.rules.length ? `<button class="btn sm ghost" type="button" data-fclear="1">Clear filters</button>` : ""}${n ? `<span class="tag">${n} active</span>` : ""}</div></div>`;
}
const defaultOp = (def) => (OPS[def.t] || OPS.t)[0][0];

/* ---------- Contacts ---------- */
const CTABS = [["companies", "All companies"], ["leads", "Leads"], ["partners", "Partners"], ["clients", "Clients"], ["people", "People"], ["deals", "Deals"]];
function ctabRows(tab) {
  const cos = [...X.co.values()];
  return { companies: cos, leads: cos.filter((c) => c.lead), partners: cos.filter((c) => c.partner), clients: cos.filter((c) => c.client), people: [...X.contact.values()], deals: [...X.deal.values()] }[tab] || [];
}
const nextCell = (c) => (c.next ? `${c.next.due_date ? `<span class="when ${whenCls(c.next.due_date)}">${esc(rel(c.next.due_date))}</span> ` : ""}${esc(c.next.title)}` : '<span style="color:var(--muted)">–</span>');
function vContacts() {
  const tab = S.ctab;
  const seg = CTABS.map(([k, l]) => `<button type="button" data-ctab="${k}" aria-pressed="${tab === k}">${l} <span style="font-family:var(--font-mono);color:var(--muted)">${ctabRows(k).length}</span></button>`).join("");
  const sorts = { next: "Next task due", last: "Last contacted (oldest)", recent: "Recently added", name: "Name A–Z" };
  const newKind = { people: "contact", deals: "deal" }[tab] || "company";
  const head = `<div class="toolbar"><div class="seg" style="flex-wrap:wrap">${seg}</div></div><div class="toolbar"><input id="cq" class="field-in" type="search" placeholder="Quick search: name, person, email, notes" value="${esc(S.cq)}" style="flex:1;min-width:180px"><select id="csort" class="field-in" aria-label="Sort">${Object.entries(sorts).map(([k, l]) => `<option value="${k}" ${S.csort === k ? "selected" : ""}>${l}</option>`).join("")}</select><button class="btn sm" type="button" data-new="${newKind}">+ ${KIND[newKind].label}</button></div>${filterBar()}`;
  const q = S.cq.trim().toLowerCase();
  let list = applyFilters(ctabRows(tab)).filter((r) => !q || [r.name, r.title, r.primary?.name, r.email, r.niche, r.location, r.notes, r.role, X.co.get(r.company_id)?.name, ...(r.people || []).map((p) => p.name + " " + (p.email || ""))].some((v) => v && String(v).toLowerCase().includes(q)));
  const keyDate = (r) => r.next?.due_date || r.expected_close || "9999";
  const cmp = { next: (a, b) => String(keyDate(a)).localeCompare(String(keyDate(b))), last: (a, b) => String(a.last_contacted || "0000").localeCompare(String(b.last_contacted || "0000")), recent: (a, b) => String(b.created_at).localeCompare(String(a.created_at)), name: (a, b) => String(a.name || a.title).localeCompare(String(b.name || b.title)) }[S.csort];
  list.sort(cmp);
  const co = (r) => `<b>${esc(r.name)}</b><div style="color:var(--muted)">${esc(r.primary?.name || r.location || "")}</div>`;
  const COLS = {
    companies: [["Company", co], ["Roles", roleChips], ["Fit", (r) => chip("fit", r.fit)], ["Last contacted", (r) => `<span class="when">${esc(rel(r.last_contacted))}</span>`], ["Next task", nextCell]],
    leads: [["Business", co], ["Stage", (r) => chip("lead_stage", r.lead.stage)], ["Fit", (r) => chip("fit", r.fit)], ["Source", (r) => esc(r.source || "")], ["Last contacted", (r) => `<span class="when">${esc(rel(r.last_contacted))}</span>`], ["Next task", nextCell]],
    partners: [["Business", co], ["Stage", (r) => chip("partner_stage", r.partner.stage)], ["Type", (r) => chip("partner_type", r.partner.partner_type)], ["Fit", (r) => chip("fit", r.fit)], ["Referrals in / out", (r) => `<span class="when">${r.partner.referrals_received || 0} / ${r.partner.referrals_sent || 0}</span>`], ["Next task", nextCell]],
    clients: [["Client", co], ["Stage", (r) => chip("client_stage", r.client.stage)], ["Services", (r) => (r.client.services || []).map((s) => chip("services", s)).join(" ")], ["Monthly", (r) => `<span class="when">${money(r.client.monthly_value)}</span>`], ["Review", (r) => `<span class="when ${whenCls(r.client.review_date)}">${esc(fmtDate(r.client.review_date))}</span>`], ["Next task", nextCell]],
    people: [["Name", (r) => `<b>${esc(r.name)}</b><div style="color:var(--muted)">${esc(r.role || "")}</div>`], ["Company", (r) => esc(X.co.get(r.company_id)?.name || "")], ["Email", (r) => esc(r.email || "")], ["Phone", (r) => esc(r.phone || "")], ["Met", (r) => (r.met_in_person ? "✓" : "")]],
    deals: [["Deal", (r) => `<b>${esc(r.title)}</b><div style="color:var(--muted)">${esc(X.co.get(r.company_id)?.name || "")}</div>`], ["Stage", (r) => chip("deal_stage", r.stage)], ["Offer", (r) => chip("offer", r.offer)], ["Value", (r) => `<span class="when" style="color:var(--ink)">${money(r.value, r.currency)}${r.billing_period === "Monthly" ? "/m" : ""}</span>`], ["Expected close", (r) => `<span class="when">${esc(fmtDate(r.expected_close))}</span>`], ["Invoices", (r) => (r.invoices || []).map((i) => chip("invoice_status", i.status)).join(" ")]],
  }[tab];
  const openKind = tab === "people" ? "contact" : tab === "deals" ? "deal" : "company";
  return head + `<div class="tag" style="margin:-4px 0 8px">Showing ${list.length} of ${ctabRows(tab).length}</div><div class="tablewrap"><table><thead><tr>${COLS.map((c) => `<th scope="col">${c[0]}</th>`).join("")}</tr></thead><tbody>${list.map((r) => `<tr ${openAttr(openKind, r.id)}>${COLS.map((c) => `<td>${c[1](r)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${COLS.length}" class="empty">Nothing matches.</td></tr>`}</tbody></table></div>`;
}

/* ---------- Tasks ---------- */
function vTasks() {
  const head = `<div class="toolbar"><input id="tq" class="field-in" type="search" placeholder="Quick search tasks and notes" value="${esc(S.tq)}" style="flex:1;min-width:180px"><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="tdone" ${S.tshowDone ? "checked" : ""}> Show done</label><button class="btn sm primary" type="button" data-new="task">+ Task</button></div>${filterBar()}`;
  const t = today(), wk = addDays(t, 7), q = S.tq.trim().toLowerCase(), filtered = fstate().rules.some(ruleReady);
  const list = applyFilters([...X.task.values()]).filter((x) => !q || [x.title, x.notes, linkName(x)].some((v) => v && String(v).toLowerCase().includes(q)));
  const open = list.filter((x) => x.status !== "Done"), g = { over: [], today: [], week: [], later: [], none: [] };
  for (const x of open) { const d = x.due_date; if (!d) g.none.push(x); else if (d < t) g.over.push(x); else if (d === t) g.today.push(x); else if (d <= wk) g.week.push(x); else g.later.push(x); }
  const pr = { High: 0, Medium: 1, Low: 2 };
  for (const k in g) g[k].sort((a, b) => String(a.due_date || "").localeCompare(String(b.due_date || "")) || (pr[a.priority] ?? 3) - (pr[b.priority] ?? 3));
  const sec = (title, arr, cls) => `<section class="panel"><h2 ${cls ? `style="color:var(--${cls})"` : ""}>${title} <span class="n">${arr.length}</span></h2>${arr.length ? arr.map(taskRow).join("") : '<div class="empty">None.</div>'}</section>`;
  const doneAll = list.filter((x) => x.status === "Done");
  const done = S.tshowDone ? doneAll.filter((x) => filtered || q || !x.done_on || x.done_on >= addDays(t, -14)).sort((a, b) => String(b.done_on || "").localeCompare(String(a.done_on || ""))) : [];
  return head + `<div class="tag" style="margin:-4px 0 8px">${open.length} open${S.tshowDone ? ` · ${done.length} done` : doneAll.length ? ` · ${doneAll.length} done hidden` : ""}${filtered || q ? ` (filtered from ${X.task.size})` : ""}</div><div class="grid">${g.over.length ? sec("Overdue", g.over, "bad") : ""}${sec("Today", g.today)}${sec("Next 7 days", g.week)}${g.later.length ? sec("Later", g.later) : ""}${sec("No due date", g.none)}${S.tshowDone ? sec(filtered || q ? "Done" : "Done (last 14 days)", done) : ""}</div>`;
}

/* ---------- Planner ---------- */
const mondayOf = (iso) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return localISO(d); };
function vPlanner() {
  if (!S.weekStart) S.weekStart = mondayOf(today());
  const days = Array.from({ length: 7 }, (_, i) => addDays(S.weekStart, i)), t = today();
  const head = `<div class="toolbar"><button class="btn sm" type="button" data-week="-7" aria-label="Previous week">←</button><button class="btn sm" type="button" data-week="0">This week</button><button class="btn sm" type="button" data-week="7" aria-label="Next week">→</button><b style="margin-left:6px">${esc(fmtDate(days[0]))} – ${esc(fmtDate(days[6]))}</b><span style="margin-left:auto"></span><button class="btn sm" type="button" data-new="block">+ Day block</button></div>
  <div class="legend"><span><i style="background:var(--c-purple-i)"></i>Day block</span><span><i style="background:var(--accent)"></i>Task</span><span><i style="background:var(--warn)"></i>Audit due</span><span><i style="background:var(--c-pink-i)"></i>Content</span></div>`;
  const by = {}; for (const d of days) by[d] = [];
  const put = (d, html, sort) => { if (d && by[d]) by[d].push({ html, sort }); };
  for (const b of X.block.values()) if (b.starts_at) put(localISO(new Date(b.starts_at)), `<div class="pi block ${b.status === "Done" ? "done" : ""}" ${openAttr("block", b.id)}><span class="tm">${fmtTime(b.starts_at)}${b.ends_at ? "–" + fmtTime(b.ends_at) : ""}</span>${esc(b.title)}</div>`, "1" + b.starts_at);
  for (const x of X.task.values()) put(x.due_date, `<div class="pi task ${x.status === "Done" ? "done" : ""}" ${openAttr("task", x.id)}>${x.due_time ? `<span class="tm">${esc(String(x.due_time).slice(0, 5))}</span>` : ""}${esc(x.title)}${linkName(x) ? `<span class="tm">${esc(linkName(x))}</span>` : ""}</div>`, "2" + (x.due_time || ""));
  for (const c of X.co.values()) if (c.lead?.stage === "Audit requested") put(c.lead.audit_due, `<div class="pi next" ${openAttr("company", c.id)}><span class="tm">Audit due</span>${esc(c.name)}</div>`, "3");
  for (const c of X.content.values()) put(c.publish_date, `<div class="pi content ${c.status === "Published" ? "done" : ""}" ${openAttr("content", c.id)}><span class="tm">${esc(c.format || "Content")}</span>${esc(c.title)}</div>`, "4");
  return head + `<div class="week">${days.map((d) => { const dd = new Date(d + "T12:00:00"); return `<section class="day ${d === t ? "is-today" : ""}"><h3>${DOW[dd.getDay()]}<span>${dd.getDate()} ${MON[dd.getMonth()]}</span></h3><div class="items">${by[d].sort((a, b) => a.sort.localeCompare(b.sort)).map((x) => x.html).join("") || '<span style="color:var(--muted);font-size:12px">Nothing planned</span>'}</div></section>`; }).join("")}</div>`;
}

/* ---------- Drawer ---------- */
const fid = (section, k) => `f_${section || "main"}_${k}`;
function control(f, v, section) {
  const id = fid(section, f.k), data = `data-field="${esc(f.k)}" data-section="${esc(section || "")}" data-type="${f.t}"`;
  if (f.t === "s") return `<select id="${id}" ${data}><option value="">–</option>${(OPT[f.opt] || []).map((o) => `<option ${v === o.n ? "selected" : ""}>${esc(o.n)}</option>`).join("")}</select>`;
  if (f.t === "m") return `<div class="mchips" id="${id}">${(OPT[f.opt] || []).map((o) => `<label class="mc"><input type="checkbox" ${data} data-mval="${esc(o.n)}" ${(v || []).includes(o.n) ? "checked" : ""}> ${esc(o.n)}</label>`).join("")}</div>`;
  if (f.t === "ta") return `<textarea id="${id}" ${data} rows="3">${esc(v || "")}</textarea>`;
  if (f.t === "c") return `<input id="${id}" type="checkbox" ${data} ${v ? "checked" : ""} style="justify-self:start;width:18px;height:18px">`;
  if (f.t === "dt") { const lv = v ? localISO(new Date(v)) + "T" + new Date(v).toTimeString().slice(0, 5) : ""; return `<input id="${id}" type="datetime-local" ${data} value="${lv}">`; }
  const type = { d: "date", n: "number", e: "email", p: "tel", u: "url", tm: "time" }[f.t] || "text";
  const val = f.t === "d" ? String(v || "").slice(0, 10) : f.t === "tm" ? String(v || "").slice(0, 5) : v ?? "";
  return `<input id="${id}" type="${type}" ${data} value="${esc(val)}" ${f.t === "n" ? 'inputmode="decimal"' : ""}>`;
}
const fieldsHtml = (list, obj, section) => `<div class="fields">${list.map((f) => `<label for="${fid(section, f.k)}" ${f.t === "ta" || f.t === "m" ? 'class="full" style="margin-top:4px"' : ""}>${esc(f.label)}</label>${f.t === "ta" || f.t === "m" ? `<div class="full">${control(f, obj?.[f.k], section)}</div>` : control(f, obj?.[f.k], section)}`).join("")}</div>`;
function quickLinks(r) {
  const out = [], p = r.primary;
  if (p) out.push(`<span>${esc(p.name)}${p.role ? ", " + esc(p.role) : ""}</span>`);
  const email = p?.email || r.email, phone = p?.phone || r.phone;
  if (email) out.push(`<a href="mailto:${esc(email)}">${esc(email)}</a>`);
  if (phone) out.push(`<a href="tel:${esc(String(phone).replace(/\s/g, ""))}">${esc(phone)}</a>`);
  if (r.website) { const l = plainLink(r.website); out.push(`<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.text)}</a>`); }
  for (const [k, v] of Object.entries(r.socials || {})) if (v) out.push(`<a href="${esc(plainLink(v).href)}" target="_blank" rel="noopener">${esc(k[0].toUpperCase() + k.slice(1))}</a>`);
  return out.join("");
}
function pecr(c) {
  const bt = c.business_type; if (!c.lead || bt === "Limited company") return "";
  return ["Sole trader", "Partnership", "Individual"].includes(bt) ? `<div class="banner" style="margin:0">PECR: a ${esc(bt.toLowerCase())} counts as an individual subscriber, so no cold email.</div>` : `<div class="banner" style="margin:0">Business type not confirmed. Check it's a limited company before any cold email (PECR).</div>`;
}
function timeline(acts) {
  return acts.length ? `<div class="tl">${acts.map((a) => `<div class="ev"><div class="d">${esc(fmtDate(a.occurred_on))}</div><div><button class="linkish" ${openAttr("act", a.id)} type="button">${esc(a.subject)}</button> ${chip("activity_type", a.type)} ${chip("outcome", a.outcome)}${a.body ? `<div class="x">${mdText(a.body)}</div>` : ""}</div></div>`).join("")}</div>` : '<div class="empty" style="padding:0">Nothing logged yet.</div>';
}
function companyDrawer(c) {
  const tasks = c.tasks.slice().sort((a, b) => (a.status === "Done") - (b.status === "Done") || String(a.due_date || "9").localeCompare(String(b.due_date || "9")));
  const missing = ["lead", "partner", "client"].filter((r) => !c[r]);
  const nt = c.next;
  return `<div class="dh"><div class="top"><span class="tag">Company</span>${roleChips(c)}<span style="margin-left:auto"></span><button class="btn sm ghost" type="button" data-act="close" aria-label="Close">✕</button></div>
    <input class="title" id="dtitle" data-field="name" data-section="" value="${esc(c.name)}" aria-label="Company name">
    <div class="quick">${quickLinks(c)}</div></div>
  <div class="db">
    ${pecr(c)}
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary sm" type="button" data-form="log">Log activity</button><button class="btn sm" type="button" data-form="task">Add task</button><button class="btn sm" type="button" data-form="deal">Add deal</button><button class="btn sm" type="button" data-form="contact">Add person</button></div>
    <div id="dform">${formHtml()}</div>
    <div class="nextbox ${nt && dayDiff(nt.due_date) < 0 ? "over" : ""}"><div style="flex:1"><div class="tag">Next step ${nt?.due_date ? `· <span class="when ${whenCls(nt.due_date)}">${esc(fmtDate(nt.due_date))} (${esc(rel(nt.due_date))})</span>` : ""}</div><div>${nt ? `<button class="linkish" ${openAttr("task", nt.id)} type="button">${esc(nt.title)}</button>` : "No open task"}</div></div>${nt ? checkBtn(nt) : ""}<button class="btn sm" type="button" data-form="task">${nt ? "Add another" : "Set one"}</button></div>
    <section class="sec"><h4>People <span class="n">${c.people.length}</span></h4><div class="panel">${c.people.length ? c.people.map((p) => `<div class="row click" ${openAttr("contact", p.id)}><div class="main-t"><div class="t">${esc(p.name)} ${p.is_primary ? '<span class="tag">primary</span>' : ""}</div><div class="s">${esc([p.role, p.email, p.phone].filter(Boolean).join(" · "))}</div></div></div>`).join("") : '<div class="empty">No people yet.</div>'}</div></section>
    <section class="sec"><h4>Tasks <span class="n">${tasks.filter((t) => t.status !== "Done").length} open</span></h4><div class="panel">${tasks.length ? tasks.map(taskRow).join("") : '<div class="empty">No tasks.</div>'}</div></section>
    ${c.deals.length ? `<section class="sec"><h4>Deals</h4><div class="panel">${c.deals.map((d) => `<div class="row click" ${openAttr("deal", d.id)}><div class="main-t"><div class="t">${esc(d.title)}</div><div class="s">${chip("deal_stage", d.stage)} ${d.invoices.map((i) => chip("invoice_status", i.status)).join(" ")}</div></div><span class="when" style="color:var(--ink)">${money(d.value, d.currency)}${d.billing_period === "Monthly" ? "/m" : ""}</span></div>`).join("")}</div></section>` : ""}
    <section class="sec"><h4>Timeline <span class="n">${c.acts.length}</span></h4>${timeline(c.acts)}</section>
    <section class="sec"><h4>Company details <span class="r tag">changes save automatically</span></h4>${fieldsHtml(FIELDS.company, c, "")}</section>
    ${["lead", "partner", "client"].filter((r) => c[r]).map((r) => `<section class="sec"><h4>${ROLE[r].label} details</h4>${fieldsHtml(FIELDS[r], c[r], r)}</section>`).join("")}
    ${missing.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="tag">Also a…</span>${missing.map((r) => `<button class="btn sm" type="button" data-addrole="${r}">+ ${ROLE[r].label}</button>`).join("")}</div>` : ""}
    <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn sm ghost" type="button" data-act="archive">Archive company</button></div>
  </div>`;
}
function simpleDrawer(kind, r) {
  const k = KIND[kind];
  let extra = "", linkLine = "";
  if (["task", "act", "deal", "contact", "invoice"].includes(kind)) {
    const c = X.co.get(r.company_id);
    const opts = [...X.co.values()].sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<option value="${x.id}" ${x.id === r.company_id ? "selected" : ""}>${esc(x.name)}</option>`).join("");
    linkLine = `<div class="quick" style="align-items:center"><span>Company</span><select id="f_link_company" data-field="company_id" data-section="" data-type="link" class="field-in" style="max-width:260px"><option value="">–</option>${opts}</select>${c ? `<button class="linkish" ${openAttr("company", c.id)} type="button" style="color:var(--accent)">Open</button>` : ""}</div>`;
  }
  if (kind === "task") { const l = linkOf(r); if (l && l[0] !== "company") linkLine += `<div class="quick"><span>Linked to</span><button class="linkish" ${openAttr(l[0], l[1].id)} type="button" style="color:var(--accent)">${esc(nameOf(l[0], l[1]))} (${KIND[l[0]].label})</button></div>`; }
  if (kind === "deal") extra = `<section class="sec"><h4>Invoices <span class="r"><button class="btn sm" type="button" data-form="invoice">+ Invoice</button></span></h4><div id="dform">${formHtml()}</div><div class="panel">${(r.invoices || []).length ? r.invoices.map((i) => `<div class="row click" ${openAttr("invoice", i.id)}><div class="main-t"><div class="t">${esc(i.number || "Draft invoice")}</div><div class="s">${chip("invoice_status", i.status)} ${i.due_date ? "due " + esc(fmtDate(i.due_date)) : ""}</div></div><span class="when" style="color:var(--ink)">${money(i.amount, i.currency)}</span></div>`).join("") : '<div class="empty">No invoices yet.</div>'}</div></section>`;
  if (kind === "contact") { const c = X.co.get(r.company_id); extra = c ? `<section class="sec"><h4>Activity with ${esc(r.name)}</h4>${timeline(c.acts.filter((a) => a.contact_id === r.id))}</section>` : ""; }
  if (kind === "project") { const ts = [...X.task.values()].filter((t) => t.project_id === r.id); extra = `<section class="sec"><h4>Tasks</h4><div class="panel">${ts.map(taskRow).join("") || '<div class="empty">None.</div>'}</div></section>`; }
  return `<div class="dh"><div class="top"><span class="tag">${k.label}</span><span style="margin-left:auto"></span><button class="btn sm ghost" type="button" data-act="close" aria-label="Close">✕</button></div>
    <input class="title" id="dtitle" data-field="${k.title}" data-section="" value="${esc(r[k.title] || "")}" aria-label="Name">${linkLine}</div>
  <div class="db">${kind !== "deal" ? `<div id="dform"></div>` : ""}<section class="sec"><h4>Details <span class="r tag">changes save automatically</span></h4>${fieldsHtml(FIELDS[kind], r, "")}</section>${extra}
  <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn sm ghost" type="button" data-act="archive">Archive ${k.label.toLowerCase()}</button></div></div>`;
}
function drawerRec() { if (!S.drawer) return null; return X[KIND[S.drawer.kind].map].get(S.drawer.id) || null; }
function drawerHtml() { const r = drawerRec(); if (!r) return `<div class="db"><div class="empty">This record no longer exists.</div></div>`; return S.drawer.kind === "company" ? companyDrawer(r) : simpleDrawer(S.drawer.kind, r); }
function openRecord(kind, id) {
  S.drawer = { kind, id }; S.form = null;
  $("#layer").innerHTML = `<div class="scrim" data-act="close"></div><aside class="drawer" role="dialog" aria-modal="true" aria-label="${esc(KIND[kind].label)}" id="drawer">${drawerHtml()}</aside>`;
  setTimeout(() => { const b = $("#drawer .btn.primary") || $("#dtitle"); b && b.focus(); }, 0);
}
function refreshDrawer() {
  const d = $("#drawer"); if (!S.drawer || !d) return;
  const a = document.activeElement; if (a && d.contains(a) && a.matches("input:not([type=checkbox]),textarea,select")) return;
  const sc = $(".db", d)?.scrollTop || 0; d.innerHTML = drawerHtml(); const db = $(".db", d); if (db) db.scrollTop = sc;
}
const closeDrawer = () => { S.drawer = null; S.form = null; $("#layer").innerHTML = ""; };
function formHtml() {
  const f = S.form, t = today(); if (!f) return "";
  const sel = (field, def) => (OPT[field] || []).map((o) => `<option ${o.n === def ? "selected" : ""}>${esc(o.n)}</option>`).join("");
  const r = drawerRec(); const people = S.drawer?.kind === "company" ? r.people : [];
  const who = people.length ? `<label>Person<select name="contact"><option value="">–</option>${people.map((p) => `<option value="${p.id}" ${p.is_primary ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : "<span></span>";
  const actions = (lbl) => `<div class="actions"><button class="btn sm ghost" type="button" data-act="cancelForm">Cancel</button><button class="btn sm primary" type="submit">${lbl}</button></div>`;
  if (f === "log") return `<form class="form" data-submit="log"><label class="full">What happened<input name="subject" required placeholder="e.g. Call with Rachel about the audit"></label><label>Type<select name="type">${sel("activity_type", "Email")}</select></label><label>Outcome<select name="outcome"><option value="">–</option>${sel("outcome")}</select></label><label>Date<input type="date" name="date" value="${t}"></label>${who}<label class="full">Notes<textarea name="body"></textarea></label><label class="full" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" name="follow"> Add a follow-up task</label>${actions("Log it")}</form>`;
  if (f === "task") return `<form class="form" data-submit="task"><label class="full">Task<input name="title" required placeholder="e.g. Send audit follow-up"></label><label>Due<input type="date" name="due" value="${addDays(t, 2)}"></label><label>Type<select name="type">${sel("task_type", "Follow-up")}</select></label><label>Priority<select name="priority">${sel("priority", "Medium")}</select></label><div style="display:flex;gap:6px;align-items:end;flex-wrap:wrap">${[["Tomorrow", 1], ["3 days", 3], ["1 week", 7], ["2 weeks", 14]].map(([l, n]) => `<button class="btn sm" type="button" data-quickdate="${addDays(t, n)}">${l}</button>`).join("")}</div>${actions("Add task")}</form>`;
  if (f === "deal") return `<form class="form" data-submit="deal"><label class="full">Deal name<input name="title" required value="${esc(r?.name || "")} – "></label><label>Offer<select name="offer">${sel("offer")}</select></label><label>Value<input type="number" name="value" inputmode="decimal"></label><label>Currency<select name="currency"><option>GBP</option><option>EUR</option><option>USD</option></select></label><label>Billing<select name="billing_period">${sel("billing_period", "One-off")}</select></label><label>Expected close<input type="date" name="close" value="${addDays(t, 14)}"></label><span></span>${actions("Add deal")}</form>`;
  if (f === "contact") return `<form class="form" data-submit="contact"><label class="full">Name<input name="name" required></label><label>Role<input name="role"></label><label>Email<input type="email" name="email"></label><label>Phone<input type="tel" name="phone"></label><label style="flex-direction:row;gap:6px;align-items:center;align-self:end"><input type="checkbox" name="primary" ${people.length ? "" : "checked"}> Primary contact</label>${actions("Add person")}</form>`;
  if (f === "invoice") return `<form class="form" data-submit="invoice"><label>Invoice number<input name="number"></label><label>Amount<input type="number" name="amount" inputmode="decimal" value="${esc(r?.value ?? "")}"></label><label>Issue date<input type="date" name="issue" value="${t}"></label><label>Due date<input type="date" name="due" value="${addDays(t, 14)}"></label><label>Status<select name="status">${sel("invoice_status", "Draft")}</select></label><span></span>${actions("Add invoice")}</form>`;
  return "";
}

/* ---------- New record modal ---------- */
function openNew(kind) {
  const t = today(), sel = (field, def) => (OPT[field] || []).map((o) => `<option ${o.n === def ? "selected" : ""}>${esc(o.n)}</option>`).join("");
  const coOpts = [...X.co.values()].sort((a, b) => a.name.localeCompare(b.name)).map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("");
  const body = {
    company: `<label class="full">Company name<input name="name" required></label><label>Role<select name="role"><option value="lead">Lead</option><option value="partner">Partner</option><option value="client">Client</option><option value="">None yet</option></select></label><label>Source<select name="source"><option value="">–</option>${sel("source")}</select></label><label>Contact name<input name="contact"></label><label>Contact role<input name="crole"></label><label>Email<input type="email" name="email"></label><label>Phone<input type="tel" name="phone"></label><label>Website<input name="website"></label><label>Business type<select name="business_type">${sel("business_type", "Unknown")}</select></label><label class="full">Notes<textarea name="notes"></textarea></label><label class="full" style="flex-direction:row;gap:6px;align-items:center"><input type="checkbox" name="met"> Met in person</label>`,
    task: `<label class="full">Task<input name="title" required></label><label>Due<input type="date" name="due_date" value="${t}"></label><label>Time<input type="time" name="due_time"></label><label>Type<select name="type">${sel("task_type", "Admin")}</select></label><label>Priority<select name="priority">${sel("priority", "Medium")}</select></label><label>Repeats<select name="recurrence">${sel("recurrence", "None")}</select></label><label>Company<select name="company_id"><option value="">–</option>${coOpts}</select></label>`,
    deal: `<label class="full">Deal<input name="title" required></label><label>Company<select name="company_id"><option value="">–</option>${coOpts}</select></label><label>Offer<select name="offer">${sel("offer")}</select></label><label>Value<input type="number" name="value"></label><label>Currency<select name="currency"><option>GBP</option><option>EUR</option><option>USD</option></select></label><label>Billing<select name="billing_period">${sel("billing_period", "One-off")}</select></label><label>Expected close<input type="date" name="expected_close"></label>`,
    contact: `<label class="full">Name<input name="name" required></label><label>Company<select name="company_id"><option value="">–</option>${coOpts}</select></label><label>Role<input name="role"></label><label>Email<input type="email" name="email"></label><label>Phone<input type="tel" name="phone"></label>`,
    block: `<label class="full">Block<input name="title" required></label><label>Starts<input type="datetime-local" name="starts_at" value="${t}T09:30"></label><label>Ends<input type="datetime-local" name="ends_at" value="${t}T11:00"></label><label>Focus<select name="focus">${sel("focus", "Client-getting")}</select></label><label>Output<input name="output"></label>`,
  }[kind];
  const pick = [["company", "Company"], ["task", "Task"], ["deal", "Deal"], ["contact", "Person"], ["block", "Day block"]].map(([k, l]) => `<button type="button" data-newkind="${k}" aria-pressed="${k === kind}">${l}</button>`).join("");
  $("#layer").innerHTML = `<div class="scrim" data-act="close"></div><div class="modal" role="dialog" aria-modal="true" aria-label="New ${KIND[kind].label}"><h3>New ${KIND[kind].label.toLowerCase()}</h3><div class="seg" style="margin:12px 16px 0;flex-wrap:wrap">${pick}</div><form class="form" data-submit="new" data-kind="${kind}">${body}<div class="actions"><button class="btn sm ghost" type="button" data-act="close">Cancel</button><button class="btn sm primary" type="submit">Add</button></div></form></div>`;
  setTimeout(() => { const i = $(".modal input"); i && i.focus(); }, 0);
}

/* ---------- search ---------- */
let sel = 0;
function searchResults(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const out = [], add = (kind, r, hay) => { if (out.length < 14 && hay.toLowerCase().includes(q)) out.push([kind, r]); };
  for (const c of X.co.values()) add("company", c, [c.name, c.niche, c.email, c.website, ...c.people.map((p) => p.name + " " + (p.email || ""))].join(" "));
  for (const p of X.contact.values()) add("contact", p, [p.name, p.email, p.phone].join(" "));
  for (const d of X.deal.values()) add("deal", d, d.title);
  for (const t of X.task.values()) if (t.status !== "Done") add("task", t, t.title);
  for (const c of X.content.values()) add("content", c, c.title);
  for (const p of X.proj.values()) add("project", p, p.name);
  return out;
}
function renderResults() {
  const q = $("#q").value, res = searchResults(q), box = $("#results");
  if (!q.trim()) { box.hidden = true; return; }
  box.hidden = false; sel = Math.min(sel, Math.max(res.length - 1, 0));
  box.innerHTML = res.length ? res.map(([k, r], i) => `<button type="button" class="${i === sel ? "on" : ""}" ${openAttr(k, r.id)}><span class="k">${KIND[k].label}</span><span style="flex:1">${esc(nameOf(k, r))}${k === "contact" && X.co.get(r.company_id) ? ` <span style="color:var(--muted)">· ${esc(X.co.get(r.company_id).name)}</span>` : ""}</span>${k === "company" ? roleChips(r) : ""}</button>`).join("") : `<div class="empty">No matches for “${esc(q)}”.</div>`;
}

/* ---------- events ---------- */
async function toggleTask(id) {
  const t = X.task.get(id); if (!t) return;
  const done = t.status !== "Done";
  await update("tasks", "id", id, { status: done ? "Done" : "Not started" }, t);
  if (done && t.recurrence && t.recurrence !== "None") toast(`Done. Next "${t.title}" added.`);
}
function bindEvents() {
  $("#q").addEventListener("input", () => { sel = 0; renderResults(); });
  $("#q").addEventListener("focus", renderResults);
  $("#q").addEventListener("keydown", (e) => {
    const n = $("#results").querySelectorAll("button[data-open]");
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, n.length - 1); renderResults(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); renderResults(); e.preventDefault(); }
    else if (e.key === "Enter" && n[sel]) { const [k, id] = n[sel].dataset.open.split(":"); openRecord(k, id); $("#q").value = ""; renderResults(); }
    else if (e.key === "Escape") { $("#q").value = ""; renderResults(); }
  });
  $("#addBtn").addEventListener("click", () => openNew(S.view === "tasks" ? "task" : S.view === "planner" ? "block" : "company"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("#layer").innerHTML) { closeDrawer(); return; }
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !e.target.matches("input,textarea,select"))) { e.preventDefault(); $("#q").focus(); }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search")) $("#results").hidden = true;
    const fb = e.target.closest("[data-fadd],[data-fdel],[data-fclear]");
    if (fb) { const st = fstate(), defs = fieldDefs(ftab());
      if (fb.dataset.fadd) { const d = defs.find((x) => x.t === "s") || defs[0]; st.rules.push({ k: d.k, op: defaultOp(d), v: d.t === "s" || d.t === "m" ? [] : "" }); }
      else if (fb.dataset.fdel != null) st.rules.splice(+fb.dataset.fdel, 1); else { st.rules = []; st.mode = "all"; }
      S.openPick = null; persistFilters(); render(); return; }
    const sm = e.target.closest(".pick summary"); if (sm) { const d = sm.parentElement; setTimeout(() => { S.openPick = d.open ? d.id : null; }, 0); return; }
    if (!e.target.closest(".pick")) S.openPick = null;
    const el = e.target.closest("[data-toggle],[data-open],[data-act],[data-board],[data-ctab],[data-new],[data-newkind],[data-form],[data-week],[data-quickdate],[data-addrole]");
    if (!el) return;
    if (el.dataset.toggle) { e.stopPropagation(); toggleTask(el.dataset.toggle); return; }
    if (el.dataset.open) { if (el.closest(".card") && dragging) return; $("#results").hidden = true; $("#q").value = ""; const [k, id] = el.dataset.open.split(":"); openRecord(k, id); return; }
    if (el.dataset.board) { S.board = el.dataset.board; persistUi(); render(); return; }
    if (el.dataset.ctab) { S.ctab = el.dataset.ctab; persistUi(); render(); return; }
    if (el.dataset.new) { openNew(el.dataset.new); return; }
    if (el.dataset.newkind) { openNew(el.dataset.newkind); return; }
    if (el.dataset.week) { const n = +el.dataset.week; S.weekStart = n === 0 ? mondayOf(today()) : addDays(S.weekStart || mondayOf(today()), n); render(); return; }
    if (el.dataset.quickdate) { el.closest("form").due.value = el.dataset.quickdate; return; }
    if (el.dataset.form) { S.form = S.form === el.dataset.form ? null : el.dataset.form; const box = $("#dform"); if (box) { box.innerHTML = formHtml(); const i = box.querySelector("input"); i && i.focus(); box.scrollIntoView({ block: "nearest" }); } return; }
    if (el.dataset.addrole) { const r = el.dataset.addrole, c = drawerRec(); insert(ROLE[r].table, { company_id: c.id, stage: ROLE[r].start }).then(() => { index(); refreshDrawer(); }); return; }
    const a = el.dataset.act;
    if (a === "close") closeDrawer();
    else if (a === "refresh") { toast("Refreshing…"); loadAll(); }
    else if (a === "signout") SB.auth.signOut().then(() => location.reload());
    else if (a === "toggleClosed") { S.showClosed = !S.showClosed; render(); }
    else if (a === "cancelForm") { S.form = null; const box = $("#dform"); if (box) box.innerHTML = ""; }
    else if (a === "archive") { const r = drawerRec(), k = S.drawer.kind; if (!r) return; update(tableFor(k), "id", r.id, { archived_at: new Date().toISOString() }, r).then((ok) => { if (ok) { closeDrawer(); toast(`${KIND[k].label} archived`); } }); }
  });
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "csort") { S.csort = t.value; persistUi(); render(); return; }
    if (t.id === "tdone") { S.tshowDone = t.checked; render(); return; }
    if (filterEvent(e)) return;
    if (t.dataset.field != null && t.closest("#drawer")) {
      const r = drawerRec(); if (!r) return;
      const k = t.dataset.field, section = t.dataset.section || "", type = t.dataset.type;
      let v;
      if (type === "m") { const box = t.closest(".mchips"); v = [...box.querySelectorAll("input:checked")].map((x) => x.dataset.mval); }
      else if (t.type === "checkbox") v = t.checked;
      else if (type === "dt") v = t.value ? new Date(t.value).toISOString() : null;
      else if (type === "n") v = t.value === "" ? null : Number(t.value);
      else v = t.value === "" ? null : t.value;
      if (t.id === "dtitle" && !t.value.trim()) { t.value = r[k] || ""; return; }
      if (type === "link") { update(tableFor(S.drawer.kind), "id", r.id, { company_id: v }, r).then(() => { index(); refreshDrawer(); }); return; }
      const target = section ? r[section] : r;
      if (JSON.stringify(target?.[k] ?? null) === JSON.stringify(v ?? null)) return;
      if (S.drawer.kind === "company") saveField("company", r, section, k, v);
      else update(tableFor(S.drawer.kind), "id", r.id, { [k]: v }, r);
    }
  });
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "cq") { S.cq = t.value; render(); }
    else if (t.id === "tq") { S.tq = t.value; render(); }
    else if (t.dataset.fi != null && t.dataset.fv == null && t.type !== "date") { fstate().rules[+t.dataset.fi].v = t.value; persistFilters(); render(); }
  });
  document.addEventListener("submit", onSubmit);
  // drag and drop on the pipeline
  document.addEventListener("dragstart", (e) => { const c = e.target.closest?.("[data-drag]"); if (!c) return; dragging = true; e.dataTransfer.setData("text/plain", c.dataset.drag); e.dataTransfer.effectAllowed = "move"; });
  document.addEventListener("dragend", () => setTimeout(() => { dragging = false; }, 50));
  document.addEventListener("dragover", (e) => { const col = e.target.closest?.("[data-col]"); if (!col) return; e.preventDefault(); document.querySelectorAll(".col.drop").forEach((x) => x !== col && x.classList.remove("drop")); col.classList.add("drop"); });
  document.addEventListener("dragleave", (e) => { const col = e.target.closest?.("[data-col]"); if (col && !col.contains(e.relatedTarget)) col.classList.remove("drop"); });
  document.addEventListener("drop", (e) => { const col = e.target.closest?.("[data-col]"); if (!col) return; e.preventDefault(); col.classList.remove("drop");
    const b = BOARDS[S.board], id = e.dataTransfer.getData("text/plain"); const r = b.rows().find((x) => x.id === id); if (!r) return;
    const v = col.dataset.col || null; if ((b.stage(r) || null) === v) return; b.set(r, v); });
  window.addEventListener("hashchange", route);
  window.addEventListener("online", () => { S.offline = false; loadAll(); });
  window.addEventListener("offline", () => { S.offline = true; render(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.fresh && Date.now() - S.fresh > 60000) loadAll(); });
  setInterval(() => { if (S.user) $("#sync").innerHTML = syncHtml(); }, 60000);
}
let dragging = false;
function filterEvent(e) {
  const t = e.target, st = fstate(), defs = fieldDefs(ftab());
  if (t.dataset.ff != null) { const ru = st.rules[+t.dataset.ff], d = defs.find((x) => x.k === t.value); ru.k = t.value; ru.op = defaultOp(d); ru.v = d.t === "s" || d.t === "m" ? [] : ""; }
  else if (t.dataset.fo != null) { const ru = st.rules[+t.dataset.fo], rel3 = (o) => ["last", "next", "older"].includes(o); const was = ru.op; ru.op = t.value; if (rel3(was) !== rel3(ru.op)) ru.v = ""; }
  else if (t.dataset.fv != null) { const ru = st.rules[+t.dataset.fi], a = Array.isArray(ru.v) ? ru.v : []; ru.v = t.checked ? [...new Set([...a, t.dataset.fv])] : a.filter((x) => x !== t.dataset.fv); S.openPick = `fp_${t.dataset.fi}`; }
  else if (t.dataset.fi != null) st.rules[+t.dataset.fi].v = t.value;
  else if (t.id === "fmode") st.mode = t.value;
  else return false;
  persistFilters(); render(); return true;
}
async function onSubmit(e) {
  const f = e.target; e.preventDefault();
  const kind = f.dataset.submit, fd = Object.fromEntries(new FormData(f).entries()), btn = f.querySelector("[type=submit]");
  btn.disabled = true;
  const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null));
  if (kind === "new") {
    const k = f.dataset.kind; let ok = null;
    if (k === "company") {
      const c = await insert("companies", clean({ name: fd.name, source: fd.source, website: fd.website, business_type: fd.business_type, notes: fd.notes, email: fd.contact ? null : fd.email, phone: fd.contact ? null : fd.phone }));
      if (c) {
        if (fd.role) await insert(ROLE[fd.role].table, clean({ company_id: c.id, stage: ROLE[fd.role].start, ...(fd.role === "lead" ? { first_contact: today() } : fd.role === "partner" ? { date_added: today() } : {}) }));
        if (fd.contact) await insert("contacts", clean({ company_id: c.id, name: fd.contact, role: fd.crole, email: fd.email, phone: fd.phone, is_primary: true, met_in_person: !!fd.met }));
        ok = ["company", c.id];
      }
    } else if (k === "task") { const r = await insert("tasks", clean({ ...fd, status: "Not started" })); if (r) ok = ["task", r.id]; }
    else if (k === "deal") { const r = await insert("deals", clean({ ...fd, stage: "Proposed", recurring: fd.billing_period === "Monthly" })); if (r) ok = ["deal", r.id]; }
    else if (k === "contact") { const r = await insert("contacts", clean(fd)); if (r) ok = ["contact", r.id]; }
    else if (k === "block") { const r = await insert("day_blocks", clean({ ...fd, starts_at: fd.starts_at ? new Date(fd.starts_at).toISOString() : null, ends_at: fd.ends_at ? new Date(fd.ends_at).toISOString() : null })); if (r) ok = ["block", r.id]; }
    if (ok) { toast(`${KIND[ok[0]].label} added`); openRecord(ok[0], ok[1]); } else btn.disabled = false;
    return;
  }
  const r = drawerRec(); if (!r) return;
  const coId = S.drawer.kind === "company" ? r.id : r.company_id;
  if (kind === "log") {
    const a = await insert("activities", clean({ subject: fd.subject, type: fd.type, outcome: fd.outcome, occurred_on: fd.date || today(), body: fd.body, company_id: coId, contact_id: fd.contact }));
    if (a) { reloadTable("companies"); toast("Logged"); S.form = fd.follow ? "task" : null; }
  } else if (kind === "task") {
    if (await insert("tasks", clean({ title: fd.title, due_date: fd.due, type: fd.type, priority: fd.priority, status: "Not started", company_id: coId }))) { toast("Task added"); S.form = null; }
  } else if (kind === "deal") {
    if (await insert("deals", clean({ title: fd.title, offer: fd.offer, value: fd.value, currency: fd.currency, billing_period: fd.billing_period, recurring: fd.billing_period === "Monthly", expected_close: fd.close, stage: "Proposed", company_id: coId }))) { toast("Deal added"); S.form = null; }
  } else if (kind === "contact") {
    if (await insert("contacts", clean({ name: fd.name, role: fd.role, email: fd.email, phone: fd.phone, is_primary: !!fd.primary, company_id: coId }))) { toast("Person added"); S.form = null; }
  } else if (kind === "invoice") {
    if (await insert("invoices", clean({ deal_id: r.id, company_id: r.company_id, number: fd.number, amount: fd.amount, currency: r.currency, issue_date: fd.issue, due_date: fd.due, status: fd.status }))) { toast("Invoice added"); S.form = null; }
  }
  index(); refreshDrawer();
}
function route() { const h = location.hash.replace("#", ""); S.view = VIEWS.some((v) => v[0] === h) ? h : "today"; render(); $("#view").scrollTop = 0; }

/* ---------- auth ---------- */
function authScreen(msg, mode = "signin") {
  $("#app").hidden = true; $("#mobnav").hidden = true; const a = $("#auth"); a.hidden = false;
  a.innerHTML = `<div class="authwrap"><form class="authcard" id="authform" data-mode="${mode}"><div class="brand" style="padding:0 0 6px">Next Step CRM<small>Next Step Digital</small></div>
    ${msg ? `<div class="banner ${/wrong|not|couldn|fail|invalid/i.test(msg) ? "bad" : ""}" style="margin:0">${esc(msg)}</div>` : ""}
    <label>Email<input type="email" name="email" autocomplete="username" required></label>
    ${mode !== "reset" ? `<label>Password<input type="password" name="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" required minlength="10"></label>` : ""}
    <button class="btn primary" type="submit">${mode === "signup" ? "Create account" : mode === "reset" ? "Email me a reset link" : "Sign in"}</button>
    <div class="authlinks">${mode !== "signin" ? `<button class="linkish" type="button" data-auth="signin">Back to sign in</button>` : `<button class="linkish" type="button" data-auth="reset">Forgotten password</button><button class="linkish" type="button" data-auth="signup">First time? Create the owner account</button>`}</div></form></div>`;
  a.querySelectorAll("[data-auth]").forEach((b) => b.addEventListener("click", () => authScreen("", b.dataset.auth)));
  $("#authform").addEventListener("submit", async (e) => {
    e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target).entries()), btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    if (mode === "signin") { const { error } = await SB.auth.signInWithPassword({ email: fd.email, password: fd.password }); if (error) authScreen("Sign-in failed: " + error.message); }
    else if (mode === "signup") { const { error } = await SB.auth.signUp({ email: fd.email, password: fd.password, options: { emailRedirectTo: location.origin + location.pathname } }); authScreen(error ? "Couldn't create the account: " + error.message : "Account created. Check your email for the confirmation link, then sign in here.", error ? "signup" : "signin"); }
    else { const { error } = await SB.auth.resetPasswordForEmail(fd.email, { redirectTo: location.origin + location.pathname }); authScreen(error ? "Couldn't send the email: " + error.message : "If that address has an account, a reset link is on its way.", "signin"); }
  });
}
function newPasswordScreen() {
  const a = $("#auth"); a.hidden = false; $("#app").hidden = true;
  a.innerHTML = `<div class="authwrap"><form class="authcard" id="pwform"><div class="brand" style="padding:0 0 6px">Set a new password</div><label>New password<input type="password" name="password" autocomplete="new-password" required minlength="10"></label><button class="btn primary" type="submit">Save password</button></form></div>`;
  $("#pwform").addEventListener("submit", async (e) => { e.preventDefault(); const { error } = await SB.auth.updateUser({ password: new FormData(e.target).get("password") }); if (error) toast(error.message, true); else { toast("Password saved"); start(); } });
}
async function start() {
  const { data } = await SB.auth.getSession();
  if (!data.session) return authScreen("");
  S.user = data.session.user;
  const { data: mem, error } = await SB.from("members").select("role").eq("user_id", S.user.id);
  if (!error && !(mem || []).length) { await SB.auth.signOut(); return authScreen("This account isn't a member of the CRM. Ask the owner to add it."); }
  $("#auth").hidden = true; $("#app").hidden = false; $("#mobnav").hidden = false;
  const cache = LS.get("nsd-crm-cache", null);
  if (cache?.T) { Object.assign(T, cache.T); S.fresh = cache.at; index(); S.loaded = true; }
  route(); loadAll(); realtime();
}
SB.auth.onAuthStateChange((ev) => { if (ev === "PASSWORD_RECOVERY") newPasswordScreen(); if (ev === "SIGNED_IN" && !S.user) start(); });
bindEvents();
start();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
