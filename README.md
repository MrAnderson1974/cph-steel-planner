# CPH Steel Planner

Interaktivt planlægningsboard for Toms tilbudskalkulation.

## Setup

### 1. GitHub repo
Opret et **privat** repo: `cph-steel-planner`

### 2. GitHub Pages
`Settings → Pages → Deploy from branch: main`

### 3. Personal Access Token
`Settings → Developer settings → Personal access tokens → Fine-grained`
- Repository access: `cph-steel-planner`
- Permissions: `Contents: Read and write`

### 4. Første brug
- Åbn appen på `https://dit-brugernavn.github.io/cph-steel-planner`
- Klik **Indstillinger** (øverst til højre)
- Indsæt token og repo (`dit-brugernavn/cph-steel-planner`)
- Klik **Gem indstillinger**
- Data indlæses automatisk fra GitHub

## Brug

| Handling | Metode |
|----------|--------|
| Flyt tilbud | Drag-and-drop til ny dag |
| Opdater BT | Klik input-felt på orange kort |
| Gem manuelt | `Ctrl+S` eller 💾 knap |
| Excel export | `Ctrl+E` eller 📊 knap |
| Auto-save | Hvert 30. sekund (hvis ændringer) |

## Data
`data/queue.json` er appens database. Genereres af `planner.py` og committes til dette repo.
