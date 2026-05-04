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
#   "transformers>=4.44",
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

FRAME_RE = re.compile(r"ART002-E-(\d+)")

DINO_DEFAULTS = {
    "dinov2": "facebook/dinov2-large",
    "dinov3": "facebook/dinov3-vitl16-pretrain-lvd1689m",
}


def embeddings_path(backbone: str) -> Path:
    """Backbone-suffixed path; for clip, fall back to legacy un-suffixed name."""
    p = OUT_DIR / f"embeddings_{backbone}.parquet"
    legacy = OUT_DIR / "embeddings.parquet"
    if not p.exists() and backbone == "clip" and legacy.exists():
        return legacy
    return p


def clusters_path(backbone: str) -> Path:
    p = OUT_DIR / f"clusters_{backbone}.parquet"
    legacy = OUT_DIR / "clusters.parquet"
    if not p.exists() and backbone == "clip" and legacy.exists():
        return legacy
    return p


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


def make_encoder(backbone: str, device: str, clip_model: str,
                 clip_pretrained: str, dino_model: Optional[str]):
    """Build (encode_fn, dim) for the chosen backbone.

    encode_fn takes a list of PIL images and returns L2-normalized float32
    embeddings of shape (len(batch), dim).
    """
    import torch

    if backbone == "clip":
        import open_clip
        print(f"Loading CLIP {clip_model} ({clip_pretrained}) on {device}...")
        model, _, preprocess = open_clip.create_model_and_transforms(
            clip_model, pretrained=clip_pretrained
        )
        model = model.to(device).eval()
        dim = model.visual.output_dim

        @torch.inference_mode()
        def encode(pils):
            x = torch.stack([preprocess(p) for p in pils]).to(device)
            v = model.encode_image(x)
            v = v / v.norm(dim=-1, keepdim=True)
            return v.float().cpu().numpy()

        return encode, dim

    if backbone in DINO_DEFAULTS:
        from transformers import AutoModel, AutoImageProcessor
        model_id = dino_model or DINO_DEFAULTS[backbone]
        print(f"Loading {backbone} ({model_id}) on {device}...")
        model = AutoModel.from_pretrained(model_id).to(device).eval()
        proc = AutoImageProcessor.from_pretrained(model_id)
        dim = model.config.hidden_size

        @torch.inference_mode()
        def encode(pils):
            inputs = proc(images=pils, return_tensors="pt").to(device)
            out = model(**inputs)
            # Prefer the pooler when present, else CLS token.
            v = getattr(out, "pooler_output", None)
            if v is None:
                v = out.last_hidden_state[:, 0]
            v = v / v.norm(dim=-1, keepdim=True)
            return v.float().cpu().numpy()

        return encode, dim

    raise typer.BadParameter(f"unknown --backbone {backbone!r}")


@app.command()
def embed(
    backbone: Annotated[str, typer.Option("--backbone",
        help="clip | dinov2 | dinov3")] = "dinov3",
    clip_model: Annotated[str, typer.Option("--clip-model")] = "ViT-L-14",
    clip_pretrained: Annotated[str, typer.Option("--clip-pretrained")] = "laion2b_s32b_b82k",
    dino_model: Annotated[Optional[str], typer.Option("--dino-model",
        help="HF model ID; defaults per --backbone")] = None,
    batch_size: Annotated[int, typer.Option("-b", "--batch-size")] = 64,
    concurrency: Annotated[int, typer.Option("-j", "--concurrency")] = 8,
    device: Annotated[str, typer.Option("--device")] = "cuda",
    limit: Annotated[Optional[int], typer.Option("-n", "--limit",
        help="Only process the first N items (smoke test)")] = None,
):
    """Download R2 thumbnails and write embeddings to parquet."""
    from PIL import Image

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest, items = load_manifest()
    if limit:
        items = items[:limit]
    paths = asyncio.run(fetch_all(manifest, items, concurrency))

    encode, dim = make_encoder(backbone, device, clip_model, clip_pretrained, dino_model)

    embeds = np.zeros((len(items), dim), dtype=np.float32)
    bad_mask = np.zeros(len(items), dtype=bool)
    for start in tqdm(range(0, len(items), batch_size), desc="embed"):
        chunk = list(range(start, min(start + batch_size, len(items))))
        pils = []
        ok_idx = []
        for i in chunk:
            try:
                pils.append(Image.open(paths[i]).convert("RGB"))
                ok_idx.append(i)
            except Exception as e:
                bad_mask[i] = True
                tqdm.write(f"bad image {paths[i].name}: {e}")
        if not pils:
            continue
        v_np = encode(pils)
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
    out = OUT_DIR / f"embeddings_{backbone}.parquet"
    df.to_parquet(out, index=False)
    print(f"Wrote {len(df)} rows x {dim} dims -> {out}")


# ---------- stage 2: plot ----------

@app.command()
def plot(
    backbone: Annotated[str, typer.Option("--backbone")] = "dinov3",
    reducer: Annotated[str, typer.Option("--reducer",
        help="umap | tsne")] = "umap",
    color_by: Annotated[str, typer.Option("--color-by",
        help="frame | cluster | dup")] = "cluster",
    dedupe: Annotated[bool, typer.Option("--dedupe/--no-dedupe",
        help="Keep one representative per dup_group before reducing")] = True,
    n_neighbors: Annotated[int, typer.Option("--n-neighbors",
        help="UMAP only")] = 30,
    min_dist: Annotated[float, typer.Option("--min-dist",
        help="UMAP only")] = 0.05,
    perplexity: Annotated[float, typer.Option("--perplexity",
        help="t-SNE only")] = 30.0,
    seed: Annotated[int, typer.Option("--seed")] = 42,
    title: Annotated[str, typer.Option("--title")] = "Artemis II Photo Map",
    sub_title: Annotated[str, typer.Option("--sub-title")] = "",
):
    """UMAP / t-SNE + interactive datamapplot HTML."""
    import datamapplot
    import matplotlib as mpl
    import matplotlib.cm as cm

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    needs_clusters = dedupe or color_by in ("cluster", "dup")
    if needs_clusters:
        src = clusters_path(backbone)
        if not src.exists():
            raise typer.BadParameter(
                f"requires `cluster --backbone {backbone}` first ({src} missing)"
            )
    else:
        src = embeddings_path(backbone)
        if not src.exists():
            raise typer.BadParameter(
                f"requires `embed --backbone {backbone}` first ({src} missing)"
            )
    print(f"Loading {src}...")
    df = pd.read_parquet(src)

    if dedupe:
        n_before = len(df)
        # Keep all singletons (-1) plus the first member of each dup group.
        keep = (df["dup_group"] == -1) | ~df.duplicated(subset=["dup_group"])
        df = df[keep].reset_index(drop=True)
        print(f"Dedupe: {n_before} -> {len(df)} representative points")

    X = np.vstack(df["embedding"].to_list()).astype(np.float32)
    print(f"  {len(df)} rows x {X.shape[1]} dims")

    if reducer == "umap":
        import umap
        print(f"Running UMAP (n_neighbors={n_neighbors}, min_dist={min_dist})...")
        r = umap.UMAP(
            n_neighbors=n_neighbors,
            min_dist=min_dist,
            metric="cosine",
            random_state=seed,
            verbose=True,
        )
        z = r.fit_transform(X)
    elif reducer == "tsne":
        from sklearn.manifold import TSNE
        print(f"Running t-SNE (perplexity={perplexity})...")
        # cosine metric requires init='random' (PCA init only works w/ euclidean)
        r = TSNE(
            n_components=2,
            perplexity=perplexity,
            metric="cosine",
            init="random",
            random_state=seed,
            verbose=1,
            n_jobs=-1,
        )
        z = r.fit_transform(X)
    else:
        raise typer.BadParameter(f"unknown --reducer {reducer!r}")

    if color_by == "frame":
        ranks = df["frame"].rank(method="dense") - 1
        norm = (ranks / max(ranks.max(), 1)).to_numpy()
        rgba = (cm.viridis(norm) * 255).astype(np.uint8)
        color_line = "Color = frame number (mission-time proxy)."
    elif color_by == "cluster":
        cid = df["cluster_id"].to_numpy()
        n = int(cid.max() + 1) if (cid >= 0).any() else 0
        cmap = mpl.colormaps["tab20"].resampled(max(n, 20))
        rgba = np.full((len(df), 4), 0xa0, dtype=np.uint8)
        rgba[:, 3] = 0xff
        m = cid >= 0
        rgba[m] = (cmap(cid[m] % cmap.N) * 255).astype(np.uint8)
        color_line = f"Color = cluster ({n} clusters, gray = noise)."
    elif color_by == "dup":
        gid = df["dup_group"].to_numpy()
        in_dup = gid >= 0
        rgba = np.full((len(df), 4), 0x60, dtype=np.uint8)
        rgba[:, 3] = 0xff
        rgba[in_dup, 0] = 0xff
        rgba[in_dup, 1] = 0x55
        rgba[in_dup, 2] = 0x33
        color_line = (
            f"Red = part of a near-duplicate group ({int(in_dup.sum())} photos)."
        )
    else:
        raise typer.BadParameter(f"unknown --color-by {color_by!r}")

    backbone_label = {"clip": "CLIP", "dinov2": "DINOv2", "dinov3": "DINOv3"}.get(
        backbone, backbone
    )
    reducer_label = {"umap": "UMAP", "tsne": "t-SNE"}.get(reducer, reducer)
    if not sub_title:
        sub_title = (
            f"{len(df):,} photos from NASA's Artemis II mission, embedded with "
            f"{backbone_label}, projected to 2D via {reducer_label}, and clustered."
            f"<br>"
            f'<a href="https://artemis-timeline.vercel.app/" target="_blank" '
            f'style="color:#4cc8ff;">artemis-timeline.vercel.app</a> &middot; '
            f'<a href="https://samsartor.com" target="_blank" '
            f'style="color:#4cc8ff;">samsartor.com</a>'
        )

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
        "full_url": df["full_url"],
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
        on_click="window.open(`{full_url}`, '_blank')",
    )
    suffix = "_dedup" if dedupe else ""
    out = OUT_DIR / f"map_{backbone}_{reducer}_{color_by}{suffix}.html"
    out.write_text(html)
    print(f"Wrote {out}")


# ---------- stage 3: cluster ----------

@app.command()
def cluster(
    backbone: Annotated[str, typer.Option("--backbone")] = "dinov3",
    algo: Annotated[str, typer.Option("--algo",
        help="hdbscan | kmeans")] = "kmeans",
    # HDBSCAN options
    min_cluster_size: Annotated[int, typer.Option("--min-cluster-size",
        help="HDBSCAN")] = 10,
    min_samples: Annotated[int, typer.Option("--min-samples",
        help="HDBSCAN")] = 5,
    method: Annotated[str, typer.Option("--method",
        help="HDBSCAN cluster_selection_method: eom | leaf "
             "(leaf = many small clusters, much less noise)")] = "eom",
    epsilon: Annotated[float, typer.Option("--epsilon",
        help="HDBSCAN cluster_selection_epsilon (0 disables). "
             "Try 0.05-0.15 to fold noise into nearby clusters")] = 0.0,
    # k-means options
    k: Annotated[int, typer.Option("--k", help="k for k-means")] = 100,
    seed: Annotated[int, typer.Option("--seed")] = 42,
    # near-dup options
    dup_threshold: Annotated[float, typer.Option("--dup-threshold",
        help="cosine sim >= this collapses photos into a near-duplicate group")] = 0.96,
):
    """Cluster (HDBSCAN or k-means) + greedy near-duplicate grouping."""
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    src = embeddings_path(backbone)
    if not src.exists():
        raise typer.BadParameter(f"run `embed --backbone {backbone}` first ({src} missing)")
    print(f"Loading {src}...")
    df = pd.read_parquet(src)
    X = np.vstack(df["embedding"].to_list()).astype(np.float32)

    # Embeddings are L2-normalized in stage 1, so euclidean distance on X
    # is monotone in cosine distance: ||a-b||^2 = 2 - 2 cos(a,b).
    if algo == "hdbscan":
        from sklearn.cluster import HDBSCAN
        print(f"HDBSCAN (min_cluster_size={min_cluster_size}, "
              f"min_samples={min_samples}, method={method}, "
              f"epsilon={epsilon})...")
        labels = HDBSCAN(
            min_cluster_size=min_cluster_size,
            min_samples=min_samples,
            metric="euclidean",
            cluster_selection_method=method,
            cluster_selection_epsilon=epsilon,
        ).fit_predict(X)
    elif algo == "kmeans":
        from sklearn.cluster import MiniBatchKMeans
        print(f"MiniBatchKMeans (k={k})...")
        labels = MiniBatchKMeans(
            n_clusters=k,
            batch_size=1024,
            n_init=10,
            random_state=seed,
        ).fit_predict(X)
    else:
        raise typer.BadParameter(f"unknown --algo {algo!r}")

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
    out = OUT_DIR / f"clusters_{backbone}.parquet"
    df.to_parquet(out, index=False)
    print(f"Wrote {out}")


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
