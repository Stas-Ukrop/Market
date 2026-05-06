import React from "react";
import styles from "./AppBar.module.css";
import { takeFullSnapshot } from "../snapshot/SnapshotEngine";
import { appCore } from "../../main";

export default function AppBar({ onToggleOrderbook, onToggleTrades }) {
  const snap = appCore.kernel?.getSnapshot?.() || null;

  return (
    <header className={styles.header}>
      <nav>
        <ul className={styles.list}>
          <li>
            <span> Bybit Lite Client</span>
          </li>
          <li>
            <span>
              {appCore.error ? `ERR: ${appCore.error}` : appCore.ready ? "ready" : "loading..."}
              {snap?.inflight !== undefined ? ` // inflight=${snap.inflight}` : ""}
            </span>
          </li>
        </ul>
        <ul className={styles.listSnapshot}>
          <li>
            <button onClick={() => onToggleOrderbook((v) => !v)}>Toggle Orderbook</button>
          </li>
          <li>
            <button onClick={() => onToggleTrades((v) => !v)}>Toggle Trades</button>
          </li>
        </ul>
        <ul className={styles.listSnapshot}>
          <li>
            <button className={styles.snapshot} onClick={() => takeFullSnapshot(appCore.activeCoin || "BybitMarket")}>
              snapshot
            </button>{" "}
          </li>
          <li>
            <a className={styles.listItem} href="">
              Log in
            </a>
          </li>
          <li>
            <a className={styles.listItem} href="">
              Register
            </a>
          </li>
        </ul>
      </nav>
    </header>
  );
}
