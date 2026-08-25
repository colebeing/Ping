import { api, type Recommendation } from "../api";

const CATEGORY_LABEL: Record<string, string> = { friends: "Friends", work: "Work", home: "Home", capacity: "Capacity" };
const BLOCK_LABEL: Record<string, string> = { "1": "Morning", "2": "Evening" };

export async function renderRecommendations(root: HTMLElement): Promise<void> {
  root.innerHTML = `<h2>Suggestions</h2><div class="card">Loading…</div>`;
  try {
    const { pending } = await api.listRecommendations();
    root.innerHTML = "";
    const heading = document.createElement("h2");
    heading.textContent = "Suggestions";
    root.appendChild(heading);

    if (pending.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "Nothing new yet. Keep answering — patterns show up after a few days.";
      root.appendChild(empty);
      return;
    }

    for (const rec of pending) root.appendChild(renderCard(rec));
  } catch (err) {
    root.innerHTML = `<div class="card error">Couldn't load suggestions.</div>`;
    console.error(err);
  }
}

function renderCard(rec: Recommendation): HTMLElement {
  const card = document.createElement("div");
  card.className = "card";

  const kicker = document.createElement("span");
  kicker.className = "pill";
  kicker.textContent = rec.valence === "amplify" ? "Do more of this" : "Worth addressing";
  card.appendChild(kicker);

  const title = document.createElement("h3");
  title.style.marginTop = "10px";
  title.textContent = `${CATEGORY_LABEL[rec.category]} keeps coming up in your ${BLOCK_LABEL[rec.block]} check-ins.`;
  card.appendChild(title);

  const body = document.createElement("p");
  body.textContent = `Add "Did you ${rec.suggestedHow}?" as your ${BLOCK_LABEL[rec.block]} question?`;
  card.appendChild(body);

  const accept = document.createElement("button");
  accept.className = "btn btn-primary";
  accept.textContent = "Add it";
  accept.addEventListener("click", async () => {
    accept.textContent = "Adding…";
    accept.setAttribute("disabled", "true");
    try {
      await api.acceptRecommendation(rec.id);
      card.remove();
    } catch (err) {
      accept.textContent = "Add it";
      accept.removeAttribute("disabled");
      console.error(err);
    }
  });
  card.appendChild(accept);

  return card;
}
