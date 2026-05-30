from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import pandas as pd


@dataclass(frozen=True)
class FacetGroup:
    cluster_id: int
    facets: List[str]


class FacetClassifier:
    def __init__(self, processed_csv_path: Path) -> None:
        self.processed_csv_path = processed_csv_path
        self._df = self._load_processed_csv(processed_csv_path)

    @staticmethod
    def _load_processed_csv(path: Path) -> pd.DataFrame:
        if not path.exists():
            raise FileNotFoundError(f"Processed facets CSV not found at: {path}")
        df = pd.read_csv(path)
        required_columns = {
            "Facets",
            "facet_name_clean",
            "scoreable",
            "category",
            "cluster_id",
        }
        missing = required_columns - set(df.columns)
        if missing:
            raise ValueError(f"Processed CSV missing required columns: {sorted(missing)}")
        return df

    @property
    def total_facets(self) -> int:
        return int(len(self._df))

    def get_scoreable_facets(self) -> pd.DataFrame:
        return self._df[self._df["scoreable"].astype(bool)].copy()

    def get_unscoreable_facets(self) -> pd.DataFrame:
        return self._df[~self._df["scoreable"].astype(bool)].copy()

    def get_cluster_groups(self) -> List[FacetGroup]:
        scoreable_df = self.get_scoreable_facets()
        groups = (
            scoreable_df.groupby("cluster_id")["facet_name_clean"]
            .apply(list)
            .reset_index()
            .sort_values("cluster_id")
        )
        return [FacetGroup(int(row["cluster_id"]), row["facet_name_clean"]) for _, row in groups.iterrows()]

    def get_scoreable_metadata(self) -> pd.DataFrame:
        scoreable_df = self.get_scoreable_facets()
        return scoreable_df[
            [
                "facet_name_clean",
                "scoreable",
                "category",
                "evaluation_difficulty",
                "requires_full_context",
                "score_anchor_low",
                "score_anchor_high",
                "cluster_id",
            ]
        ].copy()

    def summary(self) -> Dict[str, int]:
        scoreable_df = self.get_scoreable_facets()
        unscoreable_df = self.get_unscoreable_facets()
        return {
            "total_facets": int(len(self._df)),
            "scoreable_facets": int(len(scoreable_df)),
            "unscoreable_facets": int(len(unscoreable_df)),
            "clusters": int(scoreable_df["cluster_id"].nunique()),
        }


def load_default_classifier() -> FacetClassifier:
    base_dir = Path(__file__).resolve().parents[1]
    processed_csv = base_dir / "data" / "facets_processed.csv"
    return FacetClassifier(processed_csv)
