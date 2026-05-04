#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "typer>=0.12",
#   "httpx>=0.27",
#   "tqdm>=4.66",
#   "numpy>=1.26",
#   "pandas>=2.2",
#   "pyarrow>=15",
#   "torch>=2.3",
#   "open-clip-torch>=2.24",
#   "pillow>=10.3",
#   "umap-learn>=0.5.7",
#   "scikit-learn>=1.4",
#   "datamapplot>=0.4",
#   "matplotlib>=3.8",
# ]
# ///
"""
clipmap: explore the Artemis II photo corpus via CLIP embeddings.

Three stages, all driven off ../vote/manifest.json (~12k EOL ART002-E images):
    embed      Download R2 thumbnails, run open_clip, write embeddings.parquet
    plot       UMAP + interactive datamapplot HTML (color by frame/cluster/dup)
    cluster    HDBSCAN clusters + greedy near-duplicate groups → clusters.parquet

Typical workflow:
    ./clipmap.py embed                 # one-time, ~10 min on a single GPU
    ./clipmap.py plot                  # exploratory map, color by mission time
    ./clipmap.py cluster               # tune --min-cluster-size, --dup-threshold
    ./clipmap.py plot --color-by cluster
    ./clipmap.py plot --color-by dup
"""

import asyncio
import json
import random
import re
from pathlib import Path
from typing import Annotated, Optional

import httpx
import numpy as np
import pandas as pd
import typer
from tqdm import tqdm
from tqdm.asyncio import tqdm as atqdm

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) clipmap/0.1 (research; +https://samsartor.com)"
)

app = typer.Typer(no_args_is_help=True, pretty_exceptions_show_locals=False)

ROOT = Path(__file__).resolve().parent
MANIFEST_PATH = ROOT.parent / "vote" / "manifest.json"
THUMBS_DIR = ROOT / "thumbs"
OUT_DIR = ROOT / "out"
EMBEDDINGS_PARQUET = OUT_DIR / "embeddings.parquet"
CLUSTERS_PARQUET = OUT_DIR / "clusters.parquet"

FRAME_RE = re.compile(r"ART002-E-(\d+)")


def load_manifest() -> tuple[dict, list[dict]]:
    with MANIFEST_PATH.open() as f:
        m = json.load(f)
    return m, m["items"]


def thumb_url(manifest: dict, guid: str) -> str:
    return f"{manifest['r2_base']}/{manifest['thumb_path']}/{guid}.jpg"


def detail_url(manifest: dict, link: str) -> str:
    return manifest["nasa_detail_base"] + link


def full_url(manifest: dict, guid: str) -> str:
    return f"{manifest['nasa_full_base']}/{guid}.JPG"


def frame_of(guid: str) -> int:
    m = FRAME_RE.match(guid)
    return int(m.group(1)) if m else -1


# ---------- stage 1: embed ----------

async def fetch_one(client: httpx.AsyncClient, url: str, dst: Path,
                    sem: asyncio.Semaphore, max_retries: int = 6) -> bool:
    if dst.exists() and dst.stat().st_size > 0:
        return True
    backoff = 1.0
    for _ in range(max_retries):
        delay: float
        async with sem:
            try:
                r = await client.get(url, timeout=30.0)
                if r.status_code == 200:
                    dst.write_bytes(r.content)
                    return True
                if r.status_code == 429 or 500 <= r.status_code < 600:
                    # Respect Retry-After if present, else exponential + jitter.
                    ra = r.headers.get("retry-after")
                    delay = float(ra) if ra and ra.isdigit() else backoff
                    delay += random.uniform(0, 0.5)
                    backoff = min(backoff * 2, 30.0)
                else:
                    tqdm.write(f"fetch failed {url}: HTTP {r.status_code}")
                    return False
            except (httpx.TimeoutException, httpx.TransportError) as e:
                delay = backoff + random.uniform(0, 0.5)
                backoff = min(backoff * 2, 30.0)
                tqdm.write(f"transient {type(e).__name__} on {url}, retry in {delay:.1f}s")
            except Exception as e:
                tqdm.write(f"fetch failed {url}: {e}")
                return False
        await asyncio.sleep(delay)
    tqdm.write(f"giving up on {url} after {max_retries} retries")
    return False


async def fetch_all(manifest: dict, items: list[dict], concurrency: int) -> list[Path]:
    THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(concurrency)
    paths = [THUMBS_DIR / f"{it['guid']}.jpg" for it in items]
    todo = [
        (thumb_url(manifest, it["guid"]), p)
        for it, p in zip(items, paths)
        if not (p.exists() and p.stat().st_size > 0)
    ]
    if not todo:
        print(f"All {len(items)} thumbnails already cached.")
        return paths
    print(f"Fetching {len(todo)} of {len(items)} thumbnails (concurrency={concurrency})...")
    headers = {"User-Agent": USER_AGENT}
    async with httpx.AsyncClient(follow_redirects=True, headers=headers,
                                 http2=False) as client:
        coros = [fetch_one(client, u, p, sem) for u, p in todo]
        await atqdm.gather(*coros, desc="thumbs")
    return paths


@app.command()
def embed(
    model_name: Annotated[str, typer.Option("--model", "-m")] = "ViT-L-14",
    pretrained: Annotated[str, typer.Option("--pretrained")] = "laion2b_s32b_b82k",
    batch_size: Annotated[int, typer.Option("-b", "--batch-size")] = 64,
    concurrency: Annotated[int, typer.Option("-j", "--concurrency")] = 8,
    device: Annotated[str, typer.Option("--device")] = "cuda",
    limit: Annotated[Optional[int], typer.Option("-n", "--limit",
        help="Only process the first N items (smoke test)")] = None,
):
    """Download R2 thumbnails and write CLIP embeddings to parquet."""
    import torch
    from PIL import Image
    import open_clip

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest, items = load_manifest()
    if limit:
        items = items[:limit]
    paths = asyncio.run(fetch_all(manifest, items, concurrency))

    print(f"Loading {model_name} ({pretrained}) on {device}...")
    model, _, preprocess = open_clip.create_model_and_transforms(
        model_name, pretrained=pretrained
    )
    model = model.to(device).eval()
    dim = model.visual.output_dim

    embeds = np.zeros((len(items), dim), dtype=np.float32)
    bad_mask = np.zeros(len(items), dtype=bool)
    with torch.inference_mode():
        for start in tqdm(range(0, len(items), batch_size), desc="embed"):
            chunk = list(range(start, min(start + batch_size, len(items))))
            batch_imgs = []
            ok_idx = []
            for i in chunk:
                try:
                    img = Image.open(paths[i]).convert("RGB")
                    batch_imgs.append(preprocess(img))
                    ok_idx.append(i)
                except Exception as e:
                    bad_mask[i] = True
                    tqdm.write(f"bad image {paths[i].name}: {e}")
            if not batch_imgs:
                continue
            x = torch.stack(batch_imgs).to(device)
            v = model.encode_image(x)
            v = v / v.norm(dim=-1, keepdim=True)
            v_np = v.float().cpu().numpy()
            for j, i in enumerate(ok_idx):
                embeds[i] = v_np[j]

    if bad_mask.any():
        print(f"Skipped {int(bad_mask.sum())} unreadable images")
    keep = ~bad_mask
    items_kept = [it for it, k in zip(items, keep) if k]
    embeds_kept = embeds[keep]

    df = pd.DataFrame({
        "guid": [it["guid"] for it in items_kept],
        "frame": [frame_of(it["guid"]) for it in items_kept],
        "thumb_url": [thumb_url(manifest, it["guid"]) for it in items_kept],
        "detail_url": [detail_url(manifest, it["link"]) for it in items_kept],
        "full_url": [full_url(manifest, it["guid"]) for it in items_kept],
        "embedding": list(embeds_kept),
    })
    df.to_parquet(EMBEDDINGS_PARQUET, index=False)
    print(f"Wrote {len(df)} rows x {dim} dims -> {EMBEDDINGS_PARQUET}")


# ---------- stage 2: plot ----------

@app.command()
def plot(
    color_by: Annotated[str, typer.Option("--color-by",
        help="frame | cluster | dup")] = "frame",
    n_neighbors: Annotated[int, typer.Option("--n-neighbors")] = 30,
    min_dist: Annotated[float, typer.Option("--min-dist")] = 0.05,
    seed: Annotated[int, typer.Option("--seed")] = 42,
    title: Annotated[str, typer.Option("--title")] = "Artemis II Photo Map",
    sub_title: Annotated[str, typer.Option("--sub-title")] = "",
):
    """UMAP + interactive datamapplot HTML."""
    import datamapplot
    import matplotlib as mpl
    import matplotlib.cm as cm
    import umap

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    needs_clusters = color_by in ("cluster", "dup")
    src = CLUSTERS_PARQUET if (needs_clusters and CLUSTERS_PARQUET.exists()) \
          else EMBEDDINGS_PARQUET
    if needs_clusters and src is EMBEDDINGS_PARQUET:
        raise typer.BadParameter(
            f"--color-by {color_by} requires running `cluster` first"
        )
    print(f"Loading {src}...")
    df = pd.read_parquet(src)
    X = np.vstack(df["embedding"].to_list()).astype(np.float32)
    print(f"  {len(df)} rows x {X.shape[1]} dims")

    print(f"Running UMAP (n_neighbors={n_neighbors}, min_dist={min_dist})...")
    reducer = umap.UMAP(
        n_neighbors=n_neighbors,
        min_dist=min_dist,
        metric="cosine",
        random_state=seed,
        verbose=True,
    )
    z = reducer.fit_transform(X)

    if color_by == "frame":
        ranks = df["frame"].rank(method="dense") - 1
        norm = (ranks / max(ranks.max(), 1)).to_numpy()
        rgba = (cm.viridis(norm) * 255).astype(np.uint8)
        sub_title = sub_title or "Color = frame number (mission-time proxy)"
    elif color_by == "cluster":
        cid = df["cluster_id"].to_numpy()
        n = int(cid.max() + 1) if (cid >= 0).any() else 0
        cmap = mpl.colormaps["tab20"].resampled(max(n, 20))
        rgba = np.full((len(df), 4), 0xa0, dtype=np.uint8)
        rgba[:, 3] = 0xff
        m = cid >= 0
        rgba[m] = (cmap(cid[m] % cmap.N) * 255).astype(np.uint8)
        sub_title = sub_title or f"Color = HDBSCAN cluster ({n} clusters, gray = noise)"
    elif color_by == "dup":
        gid = df["dup_group"].to_numpy()
        in_dup = gid >= 0
        rgba = np.full((len(df), 4), 0x60, dtype=np.uint8)
        rgba[:, 3] = 0xff
        rgba[in_dup, 0] = 0xff
        rgba[in_dup, 1] = 0x55
        rgba[in_dup, 2] = 0x33
        sub_title = sub_title or (
            f"Red = part of a near-duplicate group ({int(in_dup.sum())} photos)"
        )
    else:
        raise typer.BadParameter(f"unknown --color-by {color_by!r}")

    point_df = pd.DataFrame({
        "x": z[:, 0], "y": z[:, 1],
        "r": rgba[:, 0], "g": rgba[:, 1], "b": rgba[:, 2], "a": rgba[:, 3],
        # Plain-text fallback; the HTML template below replaces it on render.
        "hover_text": df["guid"].to_numpy(),
    })

    extra = pd.DataFrame({
        "guid": df["guid"],
        "frame": df["frame"],
        "thumb_url": df["thumb_url"],
        "detail_url": df["detail_url"],
    })
    if "cluster_id" in df.columns:
        extra["cluster_id"] = df["cluster_id"]
    if "dup_group" in df.columns:
        extra["dup_group"] = df["dup_group"]

    hover = """
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                max-width: 320px; color: #e7eef7;">
        <img src="{thumb_url}" style="width: 320px; max-height: 240px;
            object-fit: contain; background:#000; border-radius:6px;
            margin-bottom:6px;">
        <div style="font-weight:600; font-size:13px;">{guid}</div>
        <div style="color:#8a96a6; font-size:11px;">frame #{frame}</div>
    </div>
    """

    label_df = pd.DataFrame(columns=["x", "y", "r", "g", "b", "a", "size"])
    print("Rendering datamapplot...")
    html = datamapplot.render_html(
        point_dataframe=point_df,
        label_dataframe=label_df,
        title=title,
        sub_title=sub_title,
        hover_text_html_template=hover,
        extra_point_data=extra,
        enable_search=True,
        search_field="guid",
        darkmode=True,
    )
    out = OUT_DIR / f"map_{color_by}.html"
    out.write_text(html)
    print(f"Wrote {out}")


# ---------- stage 3: cluster ----------

@app.command()
def cluster(
    min_cluster_size: Annotated[int, typer.Option("--min-cluster-size")] = 10,
    min_samples: Annotated[int, typer.Option("--min-samples")] = 5,
    dup_threshold: Annotated[float, typer.Option("--dup-threshold",
        help="cosine sim >= this collapses photos into a near-duplicate group")] = 0.92,
):
    """HDBSCAN clusters + greedy near-duplicate grouping."""
    from sklearn.cluster import HDBSCAN

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Loading {EMBEDDINGS_PARQUET}...")
    df = pd.read_parquet(EMBEDDINGS_PARQUET)
    X = np.vstack(df["embedding"].to_list()).astype(np.float32)

    # Embeddings are L2-normalized in stage 1, so euclidean distance on X
    # is monotone in cosine distance: ||a-b||^2 = 2 - 2 cos(a,b).
    print(f"HDBSCAN (min_cluster_size={min_cluster_size}, "
          f"min_samples={min_samples})...")
    hdb = HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="euclidean",
    )
    labels = hdb.fit_predict(X)
    n_clusters = int(labels.max() + 1) if (labels >= 0).any() else 0
    n_noise = int((labels == -1).sum())
    print(f"  -> {n_clusters} clusters, {n_noise} noise points")

    print(f"Greedy near-dup detection (cosine >= {dup_threshold})...")
    dup_group = greedy_dup_groups(X, dup_threshold)
    n_groups = int(dup_group.max() + 1) if (dup_group >= 0).any() else 0
    in_dup = int((dup_group >= 0).sum())
    print(f"  -> {n_groups} duplicate groups covering {in_dup} photos")

    df["cluster_id"] = labels.astype(np.int32)
    df["dup_group"] = dup_group.astype(np.int32)
    df.to_parquet(CLUSTERS_PARQUET, index=False)
    print(f"Wrote {CLUSTERS_PARQUET}")


def greedy_dup_groups(X: np.ndarray, threshold: float) -> np.ndarray:
    """Single-link union-find by cosine sim. Returns -1 for singletons.

    For 12k x 768 float32, the full Gram matrix is ~575MB — fits in RAM. If
    the corpus grows past ~30k, switch to a chunked / FAISS-based approach.
    """
    n = X.shape[0]
    sim = X @ X.T
    np.fill_diagonal(sim, 0.0)
    parent = np.arange(n)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    rows, cols = np.where(np.triu(sim >= threshold, k=1))
    for i, j in zip(rows.tolist(), cols.tolist()):
        ra, rb = find(i), find(j)
        if ra != rb:
            parent[ra] = rb

    roots = np.array([find(i) for i in range(n)])
    counts = np.bincount(roots, minlength=n)
    new_id = -np.ones(n, dtype=np.int64)
    next_id = 0
    for r in np.where(counts > 1)[0]:
        new_id[roots == r] = next_id
        next_id += 1
    return new_id


if __name__ == "__main__":
    app()
