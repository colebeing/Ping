import { api, type AnalyticsQuestionPath, type AnalyticsResponse, type AnalyticsUserSummary, type BlockId, type Category, type QuestionPathBreakdown, type UserProfileResponse } from "../api";
import { BLOCK_LABEL, CATEGORY_LABEL } from "../blockCard";

/** Two views in one tab — the all-users list, and drilling into one person's own trend/history —
 * mirrors admin.ts's currentPath/navigate pattern, scaled down to two states instead of a whole tree. */
export async function renderAnalytics(root: HTMLElement): Promise<void> {
  let view: { kind: "list" } | { kind: "profile"; id: string } = { kind: "list" };

  const showProfile = (id: string) => {
    view = { kind: "profile", id };
    void paint();
  };
  const showList = () => {
    view = { kind: "list" };
    void paint();
  };

  const paint = async () => {
    root.innerHTML = `<h2>Analytics</h2><div class="card">Loading…</div>`;
    try {
      if (view.kind === "list") {
        const data = await api.getAnalytics();
        root.innerHTML = "";

        const heading = document.createElement("h2");
        heading.textContent = "Analytics";
        root.appendChild(heading);

        root.appendChild(renderTotals(data));
        root.appendChild(renderNotificationHealth(data));
        root.appendChild(renderDailyActivity(data));
        root.appendChild(renderQuestionCategorySection(data.questionPaths));
        root.appendChild(renderAnswerBalance(data));
        root.appendChild(renderUsersTable(data, showProfile));
      } else {
        const data = await api.getUserProfile(view.id);
        root.innerHTML = "";

        const heading = document.createElement("h2");
        heading.textContent = "Analytics";
        root.appendChild(heading);

        root.appendChild(renderUserProfile(data, showList));
      }
    } catch (err) {
      root.innerHTML = `<div class="card error">Couldn't load analytics.</div>`;
      console.error(err);
    }
  };

  await paint();
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

function renderNotificationHealth(data: AnalyticsResponse): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = "Notification delivery (last 30 days)";
  card.appendChild(h);

  const { sent30d, failed30d } = data.notificationTotals;
  const total = sent30d + failed30d;
  if (total === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No send attempts in the last 30 days.";
    card.appendChild(p);
    return card;
  }

  const rate = Math.round((sent30d / total) * 100);
  card.appendChild(barRow("Sent", sent30d, total));
  card.appendChild(barRow("Failed", failed30d, total, "no"));

  const caption = document.createElement("p");
  caption.className = "muted";
  caption.style.margin = "8px 0 0";
  caption.textContent = `${rate}% delivery rate across ${total} send attempt${total === 1 ? "" : "s"}.`;
  card.appendChild(caption);

  return card;
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

/**
 * Category breakdown, scoped to whichever question the dropdown picks — an account's answer history
 * can span several distinct "current questions" over time, so mixing them into one all-users total
 * would blur the read the same way it would on the per-user page (see renderUserProfile). Routine
 * question is always the first option, since that's every account's default starting point and
 * data.questionPaths already guarantees it's present even at zero.
 */
function renderQuestionCategorySection(paths: AnalyticsQuestionPath[]): HTMLElement {
  const wrap = document.createElement("div");

  const pickerCard = document.createElement("div");
  pickerCard.className = "card";
  const label = document.createElement("label");
  label.className = "muted";
  label.textContent = "Question";
  label.style.display = "block";
  label.style.marginBottom = "8px";
  pickerCard.appendChild(label);
  const select = document.createElement("select");
  paths.forEach((qp, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${qp.label} (${qp.totalAnswers})`;
    select.appendChild(opt);
  });
  pickerCard.appendChild(select);
  wrap.appendChild(pickerCard);

  const detail = document.createElement("div");
  wrap.appendChild(detail);

  const paintDetail = () => {
    const selected = paths[Number(select.value)] ?? paths[0];
    detail.innerHTML = "";
    detail.appendChild(renderCategoryTotalsCard(selected));
  };
  select.addEventListener("change", paintDetail);
  paintDetail();

  return wrap;
}

function renderCategoryTotalsCard(qp: AnalyticsQuestionPath): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = `Category breakdown — ${qp.label}`;
  card.appendChild(h);

  const categories = Object.keys(qp.categoryTotals) as Category[];
  // One shared scale across every category's yes/no bar, so volumes stay
  // comparable both across categories and between a category's own yes vs no.
  const max = Math.max(1, ...categories.flatMap((cat) => [qp.categoryTotals[cat].yes, qp.categoryTotals[cat].no]));

  let anyShown = false;
  for (const cat of categories) {
    const { yes, no } = qp.categoryTotals[cat];
    if (yes + no === 0) continue;
    anyShown = true;

    const label = document.createElement("p");
    label.className = "muted";
    label.style.margin = "10px 0 4px";
    label.textContent = CATEGORY_LABEL[cat];
    card.appendChild(label);

    card.appendChild(barRow("Yes", yes, max));
    card.appendChild(barRow("No", no, max, "no"));
  }

  if (!anyShown) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No categorized answers yet for this question.";
    card.appendChild(p);
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

function renderUsersTable(data: AnalyticsResponse, onSelect: (id: string) => void): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = "Users";
  card.appendChild(h);
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = "Click a user to see their own trend and history.";
  card.appendChild(note);

  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";

  const thead = document.createElement("thead");
  thead.innerHTML =
    "<tr><th>Email</th><th>Joined</th><th>Check-ins</th><th>Last active</th><th>Streak</th><th>Top category</th><th>Last notification</th></tr>";
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  for (const user of data.users) {
    const tr = document.createElement("tr");
    const joined = user.createdAt.slice(0, 10);
    const topCategory = user.topCategory ? CATEGORY_LABEL[user.topCategory] : "—";

    const emailCell = document.createElement("td");
    const emailBtn = document.createElement("button");
    emailBtn.type = "button";
    emailBtn.className = "link-btn";
    emailBtn.textContent = user.email ?? "(anonymous)";
    emailBtn.addEventListener("click", () => onSelect(user.id));
    emailCell.appendChild(emailBtn);
    tr.appendChild(emailCell);

    tr.insertAdjacentHTML(
      "beforeend",
      `<td>${joined}</td><td>${user.totalAnswers}</td><td>${user.lastActive ?? "—"}</td><td>${user.activeDayStreak}</td><td>${topCategory}</td><td>${lastNotificationCell(user.lastNotification)}</td>`,
    );
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  wrap.appendChild(table);
  card.appendChild(wrap);
  return card;
}

function lastNotificationCell(last: AnalyticsUserSummary["lastNotification"]): string {
  if (!last) return "—";
  const when = last.timestamp.slice(0, 10);
  const label = `${BLOCK_LABEL[last.block]} · ${last.channel}`;
  if (last.outcome === "failed") return `<span class="notif-failed">✗ Failed</span> — ${escapeHtml(label)}, ${when}`;
  return `<span class="notif-sent">✓ Sent</span> — ${escapeHtml(label)}, ${when}`;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function renderUserProfile(data: UserProfileResponse, onBack: () => void): HTMLElement {
  const wrap = document.createElement("div");

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "link-btn";
  backBtn.textContent = "← Back to all users";
  wrap.appendChild(backBtn);
  backBtn.addEventListener("click", onBack);

  const idCard = document.createElement("div");
  idCard.className = "card";
  const h = document.createElement("h3");
  h.textContent = data.email ?? "(anonymous)";
  idCard.appendChild(h);
  const meta = document.createElement("p");
  meta.className = "muted";
  meta.textContent = `Joined ${data.createdAt.slice(0, 10)} · ${data.timezone} · ${data.totalAnswers} check-ins · ${data.activeDayStreak}-day streak`;
  idCard.appendChild(meta);
  if (data.activeQuestion) {
    const q = document.createElement("p");
    q.style.marginTop = "8px";
    const questionText = data.activeQuestion.text.q1 || Object.values(data.activeQuestion.text).find((t) => t) || "";
    q.textContent = `Current question: ${questionText}`;
    idCard.appendChild(q);
  }
  wrap.appendChild(idCard);

  wrap.appendChild(renderOverrideHistoryCard(data));

  // A user's answer history can span several distinct "current questions" over time (the routine
  // question, then whatever it's been swapped to since) — mixing them would blur the read, since the
  // same "yes, environment" answer means something different depending on which question produced it.
  // Routine question is always questionPaths[0], per the backend's own ordering.
  const pathCard = document.createElement("div");
  pathCard.className = "card";
  const pathLabelEl = document.createElement("label");
  pathLabelEl.className = "muted";
  pathLabelEl.textContent = "Question";
  pathLabelEl.style.display = "block";
  pathLabelEl.style.marginBottom = "8px";
  pathCard.appendChild(pathLabelEl);
  const select = document.createElement("select");
  data.questionPaths.forEach((qp, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${qp.label} (${qp.totalAnswers})`;
    select.appendChild(opt);
  });
  pathCard.appendChild(select);
  wrap.appendChild(pathCard);

  const detail = document.createElement("div");
  wrap.appendChild(detail);

  const paintDetail = () => {
    const selected = data.questionPaths[Number(select.value)] ?? data.questionPaths[0];
    detail.innerHTML = "";
    detail.appendChild(renderCategoryTrendCard(selected));
    detail.appendChild(renderRecentAnswersCard(selected));
  };
  select.addEventListener("change", paintDetail);
  paintDetail();

  return wrap;
}

function renderCategoryTrendCard(data: QuestionPathBreakdown): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = `Category trend — ${data.label}`;
  card.appendChild(h);
  const note = document.createElement("p");
  note.className = "muted";
  note.textContent = "Last 14 days vs. the 14 days before that, so the direction is something you can read off real numbers, not a computed score over a small sample.";
  card.appendChild(note);

  const categories = Object.keys(data.categoryTrend) as Category[];
  let anyShown = false;
  for (const cat of categories) {
    const t = data.categoryTrend[cat];
    const allTimeTotal = t.allTime.yes + t.allTime.no;
    if (allTimeTotal === 0) continue;
    anyShown = true;

    const label = document.createElement("p");
    label.className = "muted";
    label.style.margin = "14px 0 4px";
    label.style.fontWeight = "600";
    label.textContent = `${CATEGORY_LABEL[cat]} — ${allTimeTotal} all-time`;
    card.appendChild(label);

    // One shared scale across both windows (not one each) so bar width is comparable between them —
    // that comparison is the entire point of showing two windows side by side.
    const max = Math.max(1, t.last14.yes, t.last14.no, t.prior14.yes, t.prior14.no);

    const last14Label = document.createElement("p");
    last14Label.className = "muted";
    last14Label.style.margin = "6px 0 2px";
    last14Label.textContent = `Last 14 days (${t.last14.yes + t.last14.no})`;
    card.appendChild(last14Label);
    card.appendChild(barRow("Yes", t.last14.yes, max));
    card.appendChild(barRow("No", t.last14.no, max, "no"));

    const prior14Label = document.createElement("p");
    prior14Label.className = "muted";
    prior14Label.style.margin = "10px 0 2px";
    prior14Label.textContent = `Previous 14 days (${t.prior14.yes + t.prior14.no})`;
    card.appendChild(prior14Label);
    card.appendChild(barRow("Yes", t.prior14.yes, max));
    card.appendChild(barRow("No", t.prior14.no, max, "no"));
  }

  if (!anyShown) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No categorized answers yet.";
    card.appendChild(p);
  }

  return card;
}

function renderOverrideHistoryCard(data: UserProfileResponse): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = "Swap invite history";
  card.appendChild(h);

  if (data.overrideHistory.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No swap invites accepted yet.";
    card.appendChild(p);
    return card;
  }

  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Question</th><th>Category</th><th>Accepted</th><th>Status</th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const o of data.overrideHistory) {
    const tr = document.createElement("tr");
    const category = o.category ? CATEGORY_LABEL[o.category] : "Mixed";
    const valenceLabel = o.valence === "yes" ? "Yes-path" : "No-path";
    tr.innerHTML = `<td>${escapeHtml(o.question)}</td><td>${category} (${valenceLabel})</td><td>${o.acceptedAt.slice(0, 10)}</td><td>${
      o.status === "active" ? "Active now" : "Retired"
    }</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  card.appendChild(wrap);
  return card;
}

function renderRecentAnswersCard(data: QuestionPathBreakdown): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";
  const h = document.createElement("h3");
  h.textContent = "Recent answers";
  card.appendChild(h);

  if (data.recentAnswers.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No answers yet.";
    card.appendChild(p);
    return card;
  }

  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "data-table";
  const thead = document.createElement("thead");
  thead.innerHTML = "<tr><th>Date</th><th>Block</th><th>Answer</th><th>Category</th></tr>";
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  for (const a of data.recentAnswers) {
    const tr = document.createElement("tr");
    const answerLabel = a.answer === "yes" ? "Yes" : "No";
    const category = a.category ? CATEGORY_LABEL[a.category] : "—";
    tr.innerHTML = `<td>${a.date}</td><td>${BLOCK_LABEL[a.block]}</td><td>${answerLabel}</td><td>${category}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  card.appendChild(wrap);
  return card;
}
