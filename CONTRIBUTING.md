# Contributing

Thanks for helping improve Artemis II Photo Timeline.

## Before You Start

- Keep changes small and focused.
- Follow the existing static HTML/CSS/JS style.
- Do not add a framework, build step, or dependency unless it is clearly needed.
- Avoid unrelated formatting churn.

## Local Testing

Run a local static server from the repo root:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`.

For direct file testing, open `index.html` in a browser. Media paths should still work with local `web/` and `audio/` folders.

## Photo Data

- Edit photo and audio metadata through `admin.html` when possible.
- Keep timestamps in EDT / UTC-4.
- Keep filenames and source metadata accurate.
- Do not commit raw original photos.

## Pull Requests

- Explain what changed and why.
- Include screenshots for UI changes.
- Mention any local testing done.
- Keep PRs reviewable.
