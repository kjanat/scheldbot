# Scheldbot 🤬

Geautomatiseerde code review GitHub Action — een kritische reviewer die focust op code duplicatie, kwaliteit, en verouderde implementaties. Denk CodeRabbit, maar dan in het Nederlands en met instelbare directheid.

## Features

- **Code duplicatie detectie** — wijst op gemiste hergebruik-kansen
- **Kwaliteitscontrole** — bugs, race conditions, error handling, naming
- **Recency check** — deprecated APIs, verouderde patronen, TODO's
- **Architectuur review** — separation of concerns, abstractieniveau
- **Security & performance** — XSS, injection, memory leaks, N+1's

## Usage

```yaml
name: Code Review
on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: kjanat/scheldbot@master
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          intensity: "medium"
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `github-token` | ✅ | — | GitHub token voor PR access |
| `openai-api-key` | ✅ | — | OpenAI API key |
| `intensity` | ❌ | `medium` | Review stijl (zie onder) |
| `model` | ❌ | `gpt-4o-mini` | OpenAI model |
| `language` | ❌ | `nl` | Review taal |

## Intensity Levels

| Level | Stijl |
|-------|-------|
| `low` | Beleefd, grondig, suggestief |
| `medium` | Direct, no-nonsense, eerlijk |
| `high` | Scherp, vergelijkt met anti-patterns |
| `kanker` | Full Dutch mode — scheldt maar geeft wel valide feedback |

## Review Output

De bot plaatst:
1. **PR Review** met samenvatting en verdict (approve/request changes/comment)
2. **Inline comments** op specifieke regels met severity indicators:
   - 🔴 Critical — moet gefixt
   - 🟡 Warning — zou gefixt moeten worden
   - 🔵 Suggestion — overweeg dit
   - ⚪ Nitpick — kleine opmerking

## License

MIT
