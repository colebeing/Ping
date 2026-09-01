import { api, type AnalyticsResponse, type BlockId, type Category } from "../api";
import { BLOCK_LABEL, CATEGORY_LABEL } from "../blockCard";

export async function renderAnalytics(root: HTMLElement): Promise<void> {
  root.innerHTML = `<h2>Analytics</h2><div class="card">Loading…</div>`;
  try {
    const data = await api.getAnalytics();
    root.innerHTML = "";

    const heading = document.createElement("h2");
    heading.textContent = "Analytics";
    root.appendChild(heading);

    root.appendChild(renderTotals(data));
    root.appendChild(renderDailyActivity(data));
    root.appendChild(renderCategoryTotals(data));
    root.appendChild(renderAnswerBalance(data));
    root.appendChild(renderUsersTable(data));
  } catch (err) {
    root.innerHTML = `<div class="card error">Couldn't load analytics.</div>`;
    console.error(err);
  }
}

function statTile(value: string | number, label: string): HTMLElement {
  const tile = document.createElement("div");
  tile.className = "stat-tile";
  const v = document.createElement("div");
  v.className = "stat-value";
  v.textContent = String(value);
  const l = document.createElement("div");
  l.className = "stat-label";
  l.textContent = label;
  tile.append(v, l);
  return tile;
}

function renderTotals(data: AnalyticsResponse): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "stat-grid";
  grid.append(
    statTile(data.totals.userCount, "Total users"),
    statTile(data.totals.answerCount, "Total check-ins"),
    statTile(data.totals.activeUsers7d, "Active, last 7 days"),
    statTile(data.totals.activeUsers30d, "Active, last 30 days"),
  );
  return grid;
}

function renderDailyActivity(data: AnalyticsResponse): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = "Daily check-ins (last 30 days)";
  card.appendChild(h);

  const max = Math.max(1, ...data.dailyActivity.map((d) => d.count));
  const bars = document.createElement("div");
  bars.className = "chart-bars";
  for (const day of data.dailyActivity) {
    const col = document.createElement("div");
    col.className = "col";
    col.style.height = `${Math.max(2, (day.count / max) * 100)}%`;
    col.title = `${day.date}: ${day.count}`;
    bars.appendChild(col);
  }
  card.appendChild(bars);

  const caption = document.createElement("div");
  caption.className = "chart-caption";
  const first = data.dailyActivity[0];
  const last = data.dailyActivity[data.dailyActivity.length - 1];
  caption.innerHTML = `<span>${first?.date ?? ""}</span><span>${last?.date ?? ""}</span>`;
  card.appendChild(caption);

  return card;
}

function barRow(label: string, value: number, total: number, variant?: "no"): HTMLElement {
  const row = document.createElement("div");
  row.className = "bar-row";

  const l = document.createElement("span");
  l.className = "bar-label";
  l.textContent = label;

  const track = document.createElement("div");
  track.className = "bar-track";
  const fill = document.createElement("div");
  fill.className = variant === "no" ? "bar-fill answered-no" : "bar-fill";
  const pct = total > 0 ? (value / total) * 100 : 0;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);

  const v = document.createElement("span");
  v.className = "bar-value";
  v.textContent = String(value);

  row.append(l, track, v);
  return row;
}

function renderCategoryTotals(data: AnalyticsResponse): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = "Category breakdown (all users)";
  card.appendChild(h);

  const total = Math.max(1, ...Object.values(data.categoryTotals));
  for (const cat of Object.keys(data.categoryTotals) as Category[]) {
    card.appendChild(barRow(CATEGORY_LABEL[cat], data.categoryTotals[cat], total));
  }
  return card;
}

function renderAnswerBalance(data: AnalyticsResponse): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = "Yes / No balance";
  card.appendChild(h);

  for (const block of ["1", "2", "combined", "q1", "q2", "q3", "q4"] as BlockId[]) {
    const { yes, no } = data.answerBalance[block];
    const total = yes + no;
    if (total === 0) continue; // e.g. no once-daily history yet
    const totalForBar = Math.max(1, total);

    const label = document.createElement("p");
    label.className = "muted";
    label.style.margin = "10px 0 4px";
    label.textContent = BLOCK_LABEL[block];
    card.appendChild(label);

    card.appendChild(barRow("Yes", yes, totalForBar));
    card.appendChild(barRow("No", no, totalForBar, "no"));
  }
  return card;
}

function renderUsersTable(data: AnalyticsResponse): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = "Users";
  card.appendChild(h);

  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr><th>Email</th><th>Joined</th><th>Check-ins</th><th>Last active</th><th>Streak</th><th>Top category</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const user of data.users) {
    const tr = document.createElement("tr");
    const joined = user.createdAt.slice(0, 10);
    const topCategory = user.topCategory ? CATEGORY_LABEL[user.topCategory] : "—";
    tr.innerHTML = `<td>${escapeHtml(user.email)}</td><td>${joined}</td><td>${user.totalAnswers}</td><td>${
      user.lastActive ?? "—"
    }</td><td>${user.activeDayStreak}</td><td>${topCategory}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  card.appendChild(wrap);
  return card;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
