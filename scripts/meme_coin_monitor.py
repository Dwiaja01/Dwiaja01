#!/usr/bin/env python3
"""Monitor meme coins from CoinGecko and print actionable alerts.

This script uses CoinGecko's public markets endpoint, so it does not require an
API key for casual/manual monitoring. Configure watchlist symbols and alert
thresholds with CLI flags or environment variables.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

API_URL = "https://api.coingecko.com/api/v3/coins/markets"
DEFAULT_MEME_SYMBOLS = (
    "doge",
    "shib",
    "pepe",
    "bonk",
    "wif",
    "floki",
    "popcat",
    "brett",
    "mog",
    "bome",
    "turbo",
)


@dataclass(frozen=True)
class AlertRules:
    min_volume_usd: float
    min_volume_change_pct: float
    min_price_change_pct: float
    max_price_drop_pct: float
    min_market_cap_rank: int


@dataclass(frozen=True)
class CoinSignal:
    symbol: str
    name: str
    price: float
    market_cap_rank: int | None
    volume_24h: float
    price_change_24h: float
    volume_change_pct: float | None
    reasons: tuple[str, ...]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Monitor meme coins and alert on price/volume momentum.",
    )
    parser.add_argument(
        "--symbols",
        default=os.getenv("MEME_SYMBOLS", ",".join(DEFAULT_MEME_SYMBOLS)),
        help="Comma-separated coin symbols to watch. Default: popular meme coins.",
    )
    parser.add_argument(
        "--currency",
        default=os.getenv("VS_CURRENCY", "usd"),
        help="Quote currency used by CoinGecko, e.g. usd or idr. Default: usd.",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=int(os.getenv("MONITOR_INTERVAL", "300")),
        help="Polling interval in seconds when --once is not used. Default: 300.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run one scan and exit.",
    )
    parser.add_argument(
        "--min-volume-usd",
        type=float,
        default=float(os.getenv("MIN_VOLUME_USD", "10000000")),
        help="Minimum 24h volume for a signal. Default: 10,000,000.",
    )
    parser.add_argument(
        "--min-volume-change-pct",
        type=float,
        default=float(os.getenv("MIN_VOLUME_CHANGE_PCT", "25")),
        help="Alert if volume grows by at least this percent between scans. Default: 25.",
    )
    parser.add_argument(
        "--min-price-change-pct",
        type=float,
        default=float(os.getenv("MIN_PRICE_CHANGE_PCT", "8")),
        help="Alert if 24h price change is at least this percent. Default: 8.",
    )
    parser.add_argument(
        "--max-price-drop-pct",
        type=float,
        default=float(os.getenv("MAX_PRICE_DROP_PCT", "-10")),
        help="Alert if 24h price change is at or below this percent. Default: -10.",
    )
    parser.add_argument(
        "--min-market-cap-rank",
        type=int,
        default=int(os.getenv("MIN_MARKET_CAP_RANK", "500")),
        help="Ignore coins ranked worse than this value. Default: 500.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON instead of a table.",
    )
    parser.add_argument(
        "--input-file",
        help="Read CoinGecko-compatible market JSON from a file instead of the API. Useful for tests.",
    )
    return parser.parse_args()


def fetch_markets(currency: str, per_page: int = 250) -> list[dict[str, Any]]:
    query = urllib.parse.urlencode(
        {
            "vs_currency": currency,
            "order": "market_cap_desc",
            "per_page": per_page,
            "page": 1,
            "sparkline": "false",
            "price_change_percentage": "24h",
        }
    )
    request = urllib.request.Request(
        f"{API_URL}?{query}",
        headers={"accept": "application/json", "user-agent": "meme-coin-monitor/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"CoinGecko API returned HTTP {exc.code}: {exc.reason}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Unable to reach CoinGecko API: {exc.reason}") from exc


def build_signals(
    rows: list[dict[str, Any]],
    watched_symbols: set[str],
    rules: AlertRules,
    previous_volumes: dict[str, float],
) -> list[CoinSignal]:
    signals: list[CoinSignal] = []
    for row in rows:
        symbol = str(row.get("symbol", "")).lower()
        if symbol not in watched_symbols:
            continue

        rank = row.get("market_cap_rank")
        volume = float(row.get("total_volume") or 0)
        price_change = float(row.get("price_change_percentage_24h") or 0)
        previous_volume = previous_volumes.get(symbol)
        volume_change_pct = None
        if previous_volume and previous_volume > 0:
            volume_change_pct = ((volume - previous_volume) / previous_volume) * 100
        previous_volumes[symbol] = volume

        if rank is not None and int(rank) > rules.min_market_cap_rank:
            continue

        reasons: list[str] = []
        if volume >= rules.min_volume_usd and price_change >= rules.min_price_change_pct:
            reasons.append(f"momentum: price 24h {price_change:.2f}% with volume {volume:,.0f}")
        if volume_change_pct is not None and volume_change_pct >= rules.min_volume_change_pct:
            reasons.append(f"volume spike: {volume_change_pct:.2f}% since previous scan")
        if price_change <= rules.max_price_drop_pct:
            reasons.append(f"risk alert: price 24h {price_change:.2f}%")

        if reasons:
            signals.append(
                CoinSignal(
                    symbol=symbol.upper(),
                    name=str(row.get("name", symbol)),
                    price=float(row.get("current_price") or 0),
                    market_cap_rank=int(rank) if rank is not None else None,
                    volume_24h=volume,
                    price_change_24h=price_change,
                    volume_change_pct=volume_change_pct,
                    reasons=tuple(reasons),
                )
            )
    return sorted(signals, key=lambda item: abs(item.price_change_24h), reverse=True)


def print_report(signals: list[CoinSignal], currency: str, as_json: bool) -> None:
    timestamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
    if as_json:
        print(json.dumps({"timestamp": timestamp, "currency": currency, "signals": [s.__dict__ for s in signals]}, indent=2))
        return

    print(f"\nMeme coin monitor - {timestamp} ({currency.upper()})")
    if not signals:
        print("No alerts matched the current rules.")
        return
    for signal in signals:
        rank = signal.market_cap_rank if signal.market_cap_rank is not None else "n/a"
        volume_delta = "n/a" if signal.volume_change_pct is None else f"{signal.volume_change_pct:.2f}%"
        print(
            f"- {signal.name} ({signal.symbol}) | price={signal.price:g} | "
            f"rank={rank} | volume24h={signal.volume_24h:,.0f} | "
            f"price24h={signal.price_change_24h:.2f}% | volumeΔ={volume_delta}"
        )
        for reason in signal.reasons:
            print(f"  • {reason}")


def main() -> int:
    args = parse_args()
    watched_symbols = {symbol.strip().lower() for symbol in args.symbols.split(",") if symbol.strip()}
    if not watched_symbols:
        print("At least one symbol must be provided.", file=sys.stderr)
        return 2

    rules = AlertRules(
        min_volume_usd=args.min_volume_usd,
        min_volume_change_pct=args.min_volume_change_pct,
        min_price_change_pct=args.min_price_change_pct,
        max_price_drop_pct=args.max_price_drop_pct,
        min_market_cap_rank=args.min_market_cap_rank,
    )
    previous_volumes: dict[str, float] = {}

    while True:
        if args.input_file:
            with open(args.input_file, "r", encoding="utf-8") as file_obj:
                rows = json.load(file_obj)
        else:
            try:
                rows = fetch_markets(args.currency)
            except RuntimeError as exc:
                print(f"Error: {exc}", file=sys.stderr)
                return 1

        signals = build_signals(rows, watched_symbols, rules, previous_volumes)
        print_report(signals, args.currency, args.json)
        if args.once:
            return 0
        time.sleep(args.interval)


if __name__ == "__main__":
    raise SystemExit(main())
