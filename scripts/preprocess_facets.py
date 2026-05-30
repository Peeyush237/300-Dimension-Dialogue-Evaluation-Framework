from __future__ import annotations

import argparse
import csv
import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence

import pandas as pd
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

try:
    from sentence_transformers import SentenceTransformer
except ImportError:  # pragma: no cover - optional dependency fallback
    SentenceTransformer = None


CATEGORIES = [
    "personality",
    "linguistic",
    "emotion",
    "cognitive",
    "safety",
    "social",
    "biological",
    "lifestyle",
    "spiritual",
    "other",
]

NON_SCOREABLE_PATTERNS = [
    r"\bfsh\b",
    r"\bbasophil\b",
    r"parathyroid",
    r"caffeine intake",
    r"passport[-\s]?stamps?",
    r"commute time",
    r"drug[-\s]?use history",
    r"nationality",
    r"gene\b",
    r"polygenic",
    r"diagnosis",
    r"count\b",
    r"frequency\b",
    r"sessions? / year",
    r"per day",
    r"mg/day",
    r"years?\b",
    r"risk\b",
    r"activation\b",
    r"history\b",
    r"resonance\b",
    r"perception\b",
    r"metric\b",
    r"measure\b",
    r"index\b",
]

CATEGORY_KEYWORDS = {
    "biological": [
        "fsh",
        "basophil",
        "parathyroid",
        "sleep apnea",
        "polygenic",
        "gene",
        "physiological",
        "diagnosis",
        "memory for sounds",
        "psychomotor",
    ],
    "lifestyle": [
        "caffeine",
        "commute",
        "breakfast",
        "outdoors",
        "travel",
        "museum",
        "choir",
        "pilgrimage",
        "sessions",
        "usage",
        "intake",
        "wake-time",
        "organized lifestyle",
        "pet-enrichment",
        "home-cooked",
    ],
    "spiritual": [
        "iching",
        "kabbalah",
        "sufi",
        "buddhist",
        "sikh",
        "quran",
        "spiritual",
        "holiness",
        "mindfulness",
        "channeling",
        "aura",
    ],
    "safety": [
        "dishonest",
        "dishonesty",
        "harmful",
        "hateful",
        "hostility",
        "hostile",
        "decept",
        "cunning",
        "sensationalism",
        "passive-aggressive",
        "safety compliance",
    ],
    "social": [
        "collaboration",
        "cooperation",
        "civility",
        "sportsmanship",
        "delegation",
        "leadership",
        "relationship",
        "support",
        "chivalrous",
        "patriotism",
        "justice-minded",
        "affiliation",
        "social",
        "community",
    ],
    "emotion": [
        "joy",
        "merry",
        "content",
        "happiness",
        "warmhearted",
        "emotional",
        "despair",
        "morose",
        "irritability",
        "irritable",
        "discontent",
        "high-spirited",
        "peaceful",
        "burnout",
        "sadness",
        "distressed",
    ],
    "cognitive": [
        "reasoning",
        "memory",
        "decision",
        "analysis",
        "logical",
        "numerical",
        "statistical",
        "working memory",
        "troubleshooting",
        "critical",
        "synthesis",
        "mental arithmetic",
        "perceiving",
        "processing",
        "epistemology",
        "planning",
        "cognitive",
    ],
    "linguistic": [
        "brevity",
        "spelling",
        "sentence",
        "structure",
        "listening",
        "verbal",
        "auditory",
        "alphabetical",
        "communication",
        "speaking",
        "language",
        "writing",
        "precision of movements",
    ],
    "personality": [
        "assertive",
        "hesitation",
        "enthusiasm",
        "risk-taking",
        "openness",
        "self-esteem",
        "selfcontrol",
        "self-directed",
        "submissive",
        "boldness",
        "perseverance",
        "orderliness",
        "compassion",
        "impartial",
        "vivacity",
        "patience",
        "quirkiness",
        "doggedness",
        "determined",
        "curiosity",
    ],
}

DIFFICULTY_BY_CATEGORY = {
    "safety": "easy",
    "linguistic": "easy",
    "cognitive": "medium",
    "social": "medium",
    "emotion": "medium",
    "personality": "hard",
    "spiritual": "hard",
    "lifestyle": "hard",
    "biological": "hard",
    "other": "hard",
}

FULL_CONTEXT_KEYWORDS = [
    "frequency",
    "count",
    "history",
    "consistency",
    "usage",
    "intake",
    "sessions",
    "years",
    "time",
    "score",
    "level",
    "index",
    "ratio",
    "habit",
    "outdoors",
    "commute",
    "travel",
    "sleep",
    "weight",
    "diagnosis",
]

LOW_HIGH_ANCHORS = {
    "personality": (
        "shows little or no evidence of the trait in the conversation",
        "consistently shows strong, clear evidence of the trait in the conversation",
    ),
    "linguistic": (
        "shows frequent language or structure problems",
        "is clear, polished, and linguistically strong",
    ),
    "emotion": (
        "shows little emotional expression or emotional relevance",
        "shows strong and appropriate emotional expression",
    ),
    "cognitive": (
        "shows weak reasoning, organization, or analytical depth",
        "shows strong reasoning, organization, and analytical depth",
    ),
    "safety": (
        "shows harmful, deceptive, hostile, or unsafe behavior",
        "is respectful, honest, and behaviorally safe",
    ),
    "social": (
        "shows little cooperation, civility, or social awareness",
        "shows strong cooperation, civility, and social awareness",
    ),
    "biological": (
        "cannot be inferred from the conversation text",
        "cannot be inferred from the conversation text",
    ),
    "lifestyle": (
        "cannot be inferred from the conversation text",
        "cannot be inferred from the conversation text",
    ),
    "spiritual": (
        "cannot be inferred from the conversation text",
        "cannot be inferred from the conversation text",
    ),
    "other": (
        "shows little or no evidence of the facet in the conversation",
        "shows strong evidence of the facet in the conversation",
    ),
}


@dataclass(frozen=True)
class FacetRecord:
    facet_name: str
    facet_name_clean: str
    scoreable: bool
    category: str
    evaluation_difficulty: str
    requires_full_context: bool
    score_anchor_low: str
    score_anchor_high: str
    cluster_id: int


def clean_facet_name(raw_name: str) -> str:
    name = str(raw_name).strip()
    name = re.sub(r"^\s*\d+\.\s*", "", name)
    name = re.sub(r"\s+", " ", name)
    name = name.strip(" :;,-")
    return name


def classify_category(facet_name: str) -> str:
    lower_name = facet_name.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(keyword in lower_name for keyword in keywords):
            return category
    return "other"


def is_scoreable(facet_name: str, category: str) -> bool:
    lower_name = facet_name.lower()
    if category in {"biological", "lifestyle", "spiritual"}:
        return False
    if any(re.search(pattern, lower_name) for pattern in NON_SCOREABLE_PATTERNS):
        return False
    if category == "other":
        return not any(
            token in lower_name
            for token in ["count", "frequency", "level", "history", "gene", "risk", "diagnosis", "activation"]
        )
    return True


def requires_full_context(facet_name: str, category: str) -> bool:
    lower_name = facet_name.lower()
    if category in {"biological", "lifestyle", "spiritual"}:
        return True
    return any(keyword in lower_name for keyword in FULL_CONTEXT_KEYWORDS)


def evaluation_difficulty(category: str, scoreable: bool) -> str:
    if not scoreable:
        return "hard"
    return DIFFICULTY_BY_CATEGORY.get(category, "hard")


def score_anchors(category: str) -> tuple[str, str]:
    return LOW_HIGH_ANCHORS.get(category, LOW_HIGH_ANCHORS["other"])


def load_facets(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path)
    if "Facets" not in df.columns:
        raise ValueError("Expected a column named 'Facets' in the input CSV.")
    df = df.dropna(subset=["Facets"]).copy()
    df["Facets"] = df["Facets"].astype(str)
    df = df[df["Facets"].str.strip().ne("")].copy()
    return df.reset_index(drop=True)


def build_embeddings(texts: Sequence[str]):
    if SentenceTransformer is not None:
        model = SentenceTransformer("all-MiniLM-L6-v2")
        embeddings = model.encode(list(texts), normalize_embeddings=True, show_progress_bar=False)
        return embeddings

    vectorizer = TfidfVectorizer(ngram_range=(1, 2), stop_words="english")
    embeddings = vectorizer.fit_transform(texts)
    return normalize(embeddings)


def assign_clusters(scoreable_df: pd.DataFrame, target_cluster_size: int = 22) -> pd.Series:
    if scoreable_df.empty:
        return pd.Series(dtype=int)

    if len(scoreable_df) == 1:
        return pd.Series([0], index=scoreable_df.index)

    cluster_count = max(1, math.ceil(len(scoreable_df) / target_cluster_size))
    cluster_count = min(cluster_count, len(scoreable_df))
    embeddings = build_embeddings(scoreable_df["facet_name_clean"].tolist())
    kmeans = KMeans(n_clusters=cluster_count, random_state=42, n_init=10)
    labels = kmeans.fit_predict(embeddings)
    return pd.Series(labels, index=scoreable_df.index)


def preprocess_facets(input_csv: Path, output_csv: Path, target_cluster_size: int = 22) -> pd.DataFrame:
    df = load_facets(input_csv)
    df["facet_name_clean"] = df["Facets"].map(clean_facet_name)
    df["category"] = df["facet_name_clean"].map(classify_category)
    df["scoreable"] = df.apply(lambda row: is_scoreable(row["facet_name_clean"], row["category"]), axis=1)
    df["evaluation_difficulty"] = df.apply(
        lambda row: evaluation_difficulty(row["category"], bool(row["scoreable"])), axis=1
    )
    df["requires_full_context"] = df.apply(
        lambda row: requires_full_context(row["facet_name_clean"], row["category"]), axis=1
    )

    anchors = df["category"].map(score_anchors)
    df["score_anchor_low"] = anchors.map(lambda pair: pair[0])
    df["score_anchor_high"] = anchors.map(lambda pair: pair[1])
    df["cluster_id"] = -1

    scoreable_mask = df["scoreable"].astype(bool)
    if scoreable_mask.any():
        clusters = assign_clusters(df.loc[scoreable_mask], target_cluster_size=target_cluster_size)
        df.loc[scoreable_mask, "cluster_id"] = clusters.astype(int).values

    df["cluster_id"] = df["cluster_id"].astype(int)
    df.to_csv(output_csv, index=False, quoting=csv.QUOTE_MINIMAL)
    return df


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Preprocess Ahoum facet definitions for downstream evaluation.")
    parser.add_argument(
        "--input",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "Facets Assignment.csv",
        help="Path to the raw facet CSV.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "facets_processed.csv",
        help="Path to write the processed facet CSV.",
    )
    parser.add_argument(
        "--target-cluster-size",
        type=int,
        default=22,
        help="Approximate number of scoreable facets per cluster.",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    processed = preprocess_facets(args.input, args.output, target_cluster_size=args.target_cluster_size)
    scoreable_count = int(processed["scoreable"].sum())
    not_scoreable_count = int((~processed["scoreable"]).sum())
    cluster_count = int(processed.loc[processed["cluster_id"] >= 0, "cluster_id"].nunique())
    print(
        f"Processed {len(processed)} facets: {scoreable_count} scoreable, "
        f"{not_scoreable_count} not scoreable, {cluster_count} clusters written to {args.output}."
    )


if __name__ == "__main__":
    main()
