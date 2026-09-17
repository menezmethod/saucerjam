# Confluence V2 slice builder

`build_slice.py` is the bounded Blender handoff for checkpoint 01. It generates six simple, deterministic GLBs and a manifest: three structural tiles, Reactor Bloom, portal, and Ship 01.

Run it from the repository root with Blender:

```sh
blender --background --python scripts/assets/build_slice.py -- --out=/tmp/saucerjam-slice
```

The repository host currently does not include Blender, so the script is syntax-checked here and is intended to run through Blender MCP or a local Blender install. Generated output should be reviewed and validated before copying into `src/assets/models/`.
