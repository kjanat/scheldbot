# Scheldbot 🤬

Een GitHub Action die je pull requests reviewed alsof je een gefrustreerde senior developer bent die geen tijd heeft voor bullshit.

## Features

- Automated code review comments in het Nederlands
- Schreeuwt over slechte implementaties
- Wijst op dubbele code, onnodige complexiteit, en gemiste hergebruik-kansen
- Constructief onder het gescheld (want je wilt het wél beter maken)

## Usage

```yaml
- uses: kjanat/scheldbot@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    intensity: "medium"  # low | medium | high | kanker
```

## Intensity Levels

| Level | Stijl |
|-------|-------|
| `low` | Passief-agressief, zuchtend |
| `medium` | Directe kritiek, af en toe een vloek |
| `high` | Volledige tirade, vergelijkingen met stagairs |
| `kanker` | Full Kaj mode |
