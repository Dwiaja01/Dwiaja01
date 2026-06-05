#!/usr/bin/env python3
"""
Aplikasi manajemen trading meme coin (monitoring + risk management) versi CLI.

Fitur utama:
- Ambil data market meme coin dari CoinGecko (public API).
- Hitung skor momentum sederhana untuk ranking peluang.
- Kelola posisi trading (entry, stop loss, take profit).
- Simulasi eksekusi dengan aturan risk management profesional.
- Laporan ringkas: exposure, PnL, dan daftar alert.

Catatan:
- Script ini untuk edukasi dan simulasi, BUKAN financial advice.
- Untuk production, tambahkan autentikasi exchange API, database,
  retry policy, observability, dan pengujian lebih komprehensif.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional
import math
import json
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.error import URLError

COINGECKO_MARKETS_URL = "https://api.coingecko.com/api/v3/coins/markets"


@dataclass
class CoinSnapshot:
    symbol: str
    name: str
    price: float
    market_cap: float
    volume_24h: float
    change_24h_pct: float
    change_7d_pct: float
    momentum_score: float = 0.0
    timestamp_utc: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class Position:
    symbol: str
    qty: float
    entry_price: float
    stop_loss: float
    take_profit: float
    opened_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def unrealized_pnl(self, current_price: float) -> float:
        return (current_price - self.entry_price) * self.qty


@dataclass
class RiskConfig:
    account_balance: float = 10_000.0
    max_risk_per_trade_pct: float = 1.0
    max_total_exposure_pct: float = 30.0
    max_open_positions: int = 5


class MemeCoinMonitor:
    """Mengambil dan menilai data meme coin dari CoinGecko."""

    def __init__(self, per_page: int = 50):
        self.per_page = per_page

    def fetch_market_data(self) -> List[CoinSnapshot]:
        params = {
            "vs_currency": "usd",
            "category": "meme-token",
            "order": "volume_desc",
            "per_page": self.per_page,
            "page": 1,
            "sparkline": "false",
            "price_change_percentage": "24h,7d",
        }

        url = f"{COINGECKO_MARKETS_URL}?{urlencode(params)}"
        try:
            with urlopen(url, timeout=20) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except URLError:
            payload = self._fallback_payload()

        snapshots: List[CoinSnapshot] = []
        for item in payload:
            snapshots.append(
                CoinSnapshot(
                    symbol=item.get("symbol", "").upper(),
                    name=item.get("name", "Unknown"),
                    price=float(item.get("current_price") or 0),
                    market_cap=float(item.get("market_cap") or 0),
                    volume_24h=float(item.get("total_volume") or 0),
                    change_24h_pct=float(item.get("price_change_percentage_24h") or 0),
                    change_7d_pct=float(item.get("price_change_percentage_7d_in_currency") or 0),
                )
            )

        for coin in snapshots:
            coin.momentum_score = self._calculate_momentum_score(coin)

        return sorted(snapshots, key=lambda c: c.momentum_score, reverse=True)

    @staticmethod
    def _fallback_payload() -> List[dict]:
        """Data cadangan agar script tetap bisa didemokan tanpa akses jaringan."""
        return [
            {"symbol": "doge", "name": "Dogecoin", "current_price": 0.12, "market_cap": 17_000_000_000,
             "total_volume": 650_000_000, "price_change_percentage_24h": 4.5,
             "price_change_percentage_7d_in_currency": 12.2},
            {"symbol": "shib", "name": "Shiba Inu", "current_price": 0.000024, "market_cap": 14_000_000_000,
             "total_volume": 500_000_000, "price_change_percentage_24h": 6.1,
             "price_change_percentage_7d_in_currency": 9.3},
            {"symbol": "pepe", "name": "Pepe", "current_price": 0.000008, "market_cap": 3_500_000_000,
             "total_volume": 430_000_000, "price_change_percentage_24h": 9.4,
             "price_change_percentage_7d_in_currency": 17.8},
            {"symbol": "wif", "name": "dogwifhat", "current_price": 2.1, "market_cap": 2_100_000_000,
             "total_volume": 350_000_000, "price_change_percentage_24h": -1.8,
             "price_change_percentage_7d_in_currency": 5.0},
        ]

    @staticmethod
    def _calculate_momentum_score(coin: CoinSnapshot) -> float:
        """
        Skor momentum sederhana:
        - Bobot return 24h dan 7d.
        - Ditambah faktor likuiditas (log volume).
        - Penalti volatilitas ekstrem (naik/turun terlalu tajam 24h).
        """
        liquidity_factor = math.log10(max(coin.volume_24h, 1))
        volatility_penalty = abs(coin.change_24h_pct) * 0.03
        score = (
            (coin.change_24h_pct * 0.50)
            + (coin.change_7d_pct * 0.35)
            + (liquidity_factor * 4.0)
            - volatility_penalty
        )
        return round(score, 4)


class TradingManager:
    """Mesin manajemen trading untuk simulasi gaya profesional."""

    def __init__(self, risk: RiskConfig):
        self.risk = risk
        self.positions: Dict[str, Position] = {}
        self.realized_pnl: float = 0.0

    def can_open_position(self, symbol: str, entry_price: float, stop_loss: float, qty: float) -> bool:
        if symbol in self.positions:
            return False
        if len(self.positions) >= self.risk.max_open_positions:
            return False

        trade_risk_usd = abs(entry_price - stop_loss) * qty
        max_risk_usd = self.risk.account_balance * (self.risk.max_risk_per_trade_pct / 100)
        if trade_risk_usd > max_risk_usd:
            return False

        new_notional = entry_price * qty
        total_exposure = self.current_exposure() + new_notional
        max_exposure = self.risk.account_balance * (self.risk.max_total_exposure_pct / 100)
        return total_exposure <= max_exposure

    def suggest_position_size(self, entry_price: float, stop_loss: float) -> float:
        """Hitung ukuran posisi sesuai risk-per-trade."""
        risk_per_unit = abs(entry_price - stop_loss)
        if risk_per_unit <= 0:
            return 0
        max_risk_usd = self.risk.account_balance * (self.risk.max_risk_per_trade_pct / 100)
        qty = max_risk_usd / risk_per_unit
        return round(qty, 6)

    def open_position(self, position: Position) -> bool:
        if not self.can_open_position(position.symbol, position.entry_price, position.stop_loss, position.qty):
            return False
        self.positions[position.symbol] = position
        return True

    def close_position(self, symbol: str, exit_price: float) -> Optional[float]:
        pos = self.positions.pop(symbol, None)
        if not pos:
            return None
        pnl = (exit_price - pos.entry_price) * pos.qty
        self.realized_pnl += pnl
        return pnl

    def current_exposure(self) -> float:
        return sum(pos.entry_price * pos.qty for pos in self.positions.values())

    def check_alerts(self, market: List[CoinSnapshot]) -> List[str]:
        alerts: List[str] = []
        latest_price = {c.symbol: c.price for c in market}

        for sym, pos in self.positions.items():
            price = latest_price.get(sym)
            if price is None:
                continue
            if price <= pos.stop_loss:
                alerts.append(f"STOP LOSS tersentuh {sym}: {price:.8f} <= {pos.stop_loss:.8f}")
            elif price >= pos.take_profit:
                alerts.append(f"TAKE PROFIT tersentuh {sym}: {price:.8f} >= {pos.take_profit:.8f}")

        return alerts

    def report(self, market: List[CoinSnapshot]) -> str:
        latest_price = {c.symbol: c.price for c in market}
        unrealized = 0.0
        lines = []

        for sym, pos in self.positions.items():
            px = latest_price.get(sym, pos.entry_price)
            upnl = pos.unrealized_pnl(px)
            unrealized += upnl
            lines.append(
                f"- {sym}: qty={pos.qty:.6f}, entry={pos.entry_price:.8f}, now={px:.8f}, uPnL={upnl:.2f}"
            )

        exposure = self.current_exposure()
        total_pnl = self.realized_pnl + unrealized

        summary = [
            "\n=== TRADING REPORT ===",
            f"Open positions: {len(self.positions)}",
            f"Current exposure: ${exposure:,.2f}",
            f"Realized PnL: ${self.realized_pnl:,.2f}",
            f"Unrealized PnL: ${unrealized:,.2f}",
            f"Total PnL: ${total_pnl:,.2f}",
        ]
        if lines:
            summary.append("Positions:")
            summary.extend(lines)
        else:
            summary.append("Tidak ada posisi terbuka.")

        return "\n".join(summary)


def build_trade_idea(coin: CoinSnapshot) -> Optional[Position]:
    """
    Contoh rule-based strategy sederhana:
    - Hanya pertimbangkan coin dengan momentum score tertentu.
    - Stop loss 6%, take profit 12% dari entry.
    """
    if coin.momentum_score < 8:
        return None

    entry = coin.price
    if entry <= 0:
        return None
    stop = entry * 0.94
    take = entry * 1.12

    return Position(
        symbol=coin.symbol,
        qty=0.0,
        entry_price=entry,
        stop_loss=stop,
        take_profit=take,
    )


def main() -> None:
    print("Memulai monitoring meme coin & trading management engine...\n")

    monitor = MemeCoinMonitor(per_page=40)
    risk = RiskConfig(
        account_balance=10_000,
        max_risk_per_trade_pct=1.0,
        max_total_exposure_pct=35.0,
        max_open_positions=4,
    )
    manager = TradingManager(risk)

    market = monitor.fetch_market_data()

    print("Top 10 Meme Coin (by momentum score):")
    for idx, coin in enumerate(market[:10], start=1):
        print(
            f"{idx:02d}. {coin.symbol:<8} score={coin.momentum_score:>6.2f} "
            f"price=${coin.price:.8f} 24h={coin.change_24h_pct:>6.2f}% 7d={coin.change_7d_pct:>6.2f}%"
        )

    print("\nMencoba membuka posisi dari top candidates...")
    for coin in market[:10]:
        idea = build_trade_idea(coin)
        if not idea:
            continue

        suggested_qty = manager.suggest_position_size(idea.entry_price, idea.stop_loss)
        idea.qty = suggested_qty
        if suggested_qty <= 0:
            continue

        opened = manager.open_position(idea)
        status = "OPENED" if opened else "SKIPPED"
        print(
            f"{status:<7} {idea.symbol} qty={idea.qty:.6f} "
            f"entry={idea.entry_price:.8f} SL={idea.stop_loss:.8f} TP={idea.take_profit:.8f}"
        )

    alerts = manager.check_alerts(market)
    if alerts:
        print("\nAlerts:")
        for a in alerts:
            print(f"- {a}")
    else:
        print("\nBelum ada alert SL/TP.")

    print(manager.report(market))


if __name__ == "__main__":
    main()
